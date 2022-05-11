/**
 * @license
 * Copyright 2022 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import {Analyzer} from './analyzer.js';
import * as url from 'url';
import * as pathlib from 'path';
import * as jsonParser from 'jsonc-parser';
import {
  Diagnostic,
  offsetInsideRange,
  OffsetToPositionConverter,
  PositionRange,
} from './error.js';

import type {FileSystem} from './util/package-json-reader.js';
import type {
  Diagnostic as IdeDiagnostic,
  DiagnosticSeverity,
  DiagnosticRelatedInformation,
  CodeAction,
  TextEdit,
  WorkspaceEdit,
  Position,
  DefinitionLink,
} from 'vscode-languageclient';
import type {PackageJson} from './util/package-json.js';
import type {JsonFile} from './util/ast.js';

class OverlayFilesystem implements FileSystem {
  // filename to contents
  readonly overlay = new Map<string, string>();

  async readFile(path: string, options: 'utf8'): Promise<string> {
    const contents = this.overlay.get(path);
    if (contents !== undefined) {
      return contents;
    }
    return fs.readFile(path, options);
  }
}

/**
 * The interface for an IDE to communicate with wireit's analysis pipeline.
 *
 * An IDE has certain files open with in-memory buffers. These buffers often
 * shadow the files on disk, and in those cases we want to use the buffer if
 * it's available, and fall back on disk contents if not.
 *
 * Generally the user only cares about the in-memory files, at least for
 * most features like diagnostics.
 */
export class IdeAnalyzer {
  readonly #overlayFs;
  #analyzer;
  constructor() {
    this.#overlayFs = new OverlayFilesystem();
    this.#analyzer = new Analyzer(this.#overlayFs);
  }

  /**
   * Adds the file to the set of open files if it wasn't already,
   * and specifies its contents. Open files are defined by their
   * in memory contents, not by their on-disk contents.
   *
   * We also only care about diagnostics for open files.
   *
   * IDEs will typically call this method when a user opens a package.json file
   * for editing, as well as once for each edit the user makes.
   */
  setOpenFileContents(path: string, contents: string): void {
    this.#overlayFs.overlay.set(path, contents);
    this.#analyzer = new Analyzer(this.#overlayFs);
  }

  /**
   * Removes a file from the set of open files.
   */
  closeFile(path: string): void {
    this.#overlayFs.overlay.delete(path);
    this.#analyzer = new Analyzer(this.#overlayFs);
  }

  get openFiles(): Iterable<string> {
    return this.#overlayFs.overlay.keys();
  }

  /**
   * Calculates and returns diagnostics for open files. If a file has no
   * diagnostics then we don't include an entry for it at all.
   */
  async getDiagnostics(): Promise<Map<string, Set<IdeDiagnostic>>> {
    const diagnostics = new Map<string, Set<IdeDiagnostic>>();
    function addDiagnostic(diagnostic: Diagnostic) {
      const path = diagnostic.location.file.path;
      if (!openFiles.has(path)) {
        return;
      }
      const converted = convertDiagnostic(diagnostic);
      let set = diagnostics.get(path);
      if (set === undefined) {
        set = new Set();
        diagnostics.set(path, set);
      }
      set.add(converted);
    }

    const openFiles = new Set(this.openFiles);
    for (const failure of await this.#analyzer.analyzeFiles([...openFiles])) {
      if (failure.diagnostic != null) {
        addDiagnostic(failure.diagnostic);
      }
      if (failure.diagnostics != null) {
        for (const diagnostic of failure.diagnostics) {
          addDiagnostic(diagnostic);
        }
      }
    }
    return diagnostics;
  }

  async getCodeActions(
    path: string,
    range: PositionRange
  ): Promise<CodeAction[]> {
    const codeActions: CodeAction[] = [];
    // file isn't open
    if (!this.#overlayFs.overlay.has(path)) {
      return codeActions;
    }
    const packageDir = pathlib.dirname(path);
    // If there are any syntax-level errors for the file, we don't want to
    // offer any code actions.
    const packageJsonResult = await this.#analyzer.getPackageJson(packageDir);
    if (!packageJsonResult.ok || packageJsonResult.value.failures.length > 0) {
      return codeActions;
    }
    const packageJson = packageJsonResult.value;
    const ourRange = OffsetToPositionConverter.get(
      packageJson.jsonFile
    ).ideRangeToRange(range);
    const scriptInfo = await this.#getInfoAboutLocation(
      packageJson,
      ourRange.offset
    );
    if (scriptInfo === undefined) {
      return codeActions;
    }
    if (
      scriptInfo.kind === 'scripts-section-script' &&
      scriptInfo.scriptSyntaxInfo.scriptNode &&
      !scriptInfo.scriptSyntaxInfo.wireitConfigNode
    ) {
      const edit = getEdit(packageJson.jsonFile, [
        {path: ['scripts', scriptInfo.script.name], value: 'wireit'},
        {
          path: ['wireit', scriptInfo.script.name],
          value: {command: scriptInfo.scriptSyntaxInfo.scriptNode.value},
        },
      ]);
      codeActions.push({
        title: `Refactor this script to use wireit.`,
        kind: 'refactor.extract',
        edit,
      });
    }

    return codeActions;
  }

  async getDefinition(
    path: string,
    position: Position
  ): Promise<DefinitionLink[] | undefined> {
    const packageDir = pathlib.dirname(path);
    const packageJsonResult = await this.#analyzer.getPackageJson(packageDir);
    if (!packageJsonResult.ok) {
      return undefined;
    }
    const packageJson = packageJsonResult.value;
    const ourPosition = OffsetToPositionConverter.get(
      packageJson.jsonFile
    ).idePositionToOffset(position);
    const scriptInfo = await this.#getInfoAboutLocation(
      packageJson,
      ourPosition
    );
    if (scriptInfo?.kind === 'dependency') {
      const dep = scriptInfo.dependency;
      const targetFile = dep.config.declaringFile;
      const targetNode = dep.config.configAstNode ?? dep.config.scriptAstNode;
      if (targetFile == null || targetNode == null) {
        return;
      }

      const targetConverter = OffsetToPositionConverter.get(targetFile);
      const sourceConverter = OffsetToPositionConverter.get(
        packageJson.jsonFile
      );
      return [
        {
          originSelectionRange: sourceConverter.toIdeRange(
            scriptInfo.dependency.astNode
          ),
          targetUri: url.pathToFileURL(targetFile.path).toString(),
          targetRange: targetConverter.toIdeRange(
            // The parent is the property, including both key and value.
            // So we preview the whole thing when looking at the definition:
            //      "build": {"command": "tsc"}
            //      ~~~~~~~~~~~~~~~~~~~~~~~~~~~
            targetNode.parent ?? targetNode
          ),
          targetSelectionRange: targetConverter.toIdeRange(targetNode.name),
        },
      ];
    }
    if (scriptInfo?.kind === 'scripts-section-script') {
      const sourceConverter = OffsetToPositionConverter.get(
        packageJson.jsonFile
      );
      const syntaxInfo = scriptInfo.scriptSyntaxInfo;
      if (syntaxInfo.scriptNode && syntaxInfo.wireitConfigNode) {
        // we can jump from the script section to the wireit config
        return [
          {
            originSelectionRange: sourceConverter.toIdeRange(
              syntaxInfo.scriptNode.parent ?? syntaxInfo.scriptNode
            ),
            targetUri: url.pathToFileURL(packageJson.jsonFile.path).toString(),
            targetRange: sourceConverter.toIdeRange(
              syntaxInfo.wireitConfigNode.parent ?? syntaxInfo.wireitConfigNode
            ),
            targetSelectionRange: sourceConverter.toIdeRange(
              syntaxInfo.wireitConfigNode.name
            ),
          },
        ];
      }
    }
  }

  async getPackageJsonForTest(
    filename: string
  ): Promise<PackageJson | undefined> {
    const packageDir = pathlib.dirname(filename);
    const packageJsonResult = await this.#analyzer.getPackageJson(packageDir);
    if (!packageJsonResult.ok) {
      return undefined;
    }
    return packageJsonResult.value;
  }

  async #getInfoAboutLocation(packageJson: PackageJson, offset: number) {
    const locationInfo = packageJson.getInfoAboutLocation(offset);
    if (locationInfo === undefined) {
      return;
    }
    const script = await this.#analyzer.analyzeIgnoringErrors({
      name: locationInfo.scriptSyntaxInfo.name,
      packageDir: pathlib.dirname(packageJson.jsonFile.path),
    });
    for (const dep of script.dependencies ?? []) {
      if (offsetInsideRange(offset, dep.astNode)) {
        return {
          kind: 'dependency' as const,
          dependency: dep,
          script: script,
          scriptSyntax: locationInfo.scriptSyntaxInfo,
        };
      }
    }
    return {
      ...locationInfo,
      script,
    };
  }
}

interface Modification {
  path: jsonParser.JSONPath;
  value: unknown;
}

function getEdit(file: JsonFile, modifications: Modification[]): WorkspaceEdit {
  const edits = [];
  for (const {path, value} of modifications) {
    edits.push(
      ...jsonParser.modify(
        file.contents,
        path,
        value,
        inferModificationOptions(file)
      )
    );
  }
  const converter = OffsetToPositionConverter.get(file);
  const textEdits = edits.map((e): TextEdit => {
    return {
      range: converter.toIdeRange(e),
      newText: e.content,
    };
  });
  return {changes: {[file.path]: textEdits}};
}

function inferModificationOptions(
  file: JsonFile
): jsonParser.ModificationOptions {
  const firstPostNewlineWhitespace = file.contents.match(/\n(\s+)/)?.[1];
  if (firstPostNewlineWhitespace === undefined) {
    return {};
  }
  if (/^ +$/.test(firstPostNewlineWhitespace)) {
    return {
      formattingOptions: {
        insertSpaces: true,
        tabSize: firstPostNewlineWhitespace.length,
      },
    };
  } else if (/^\t+$/.test(firstPostNewlineWhitespace)) {
    return {
      formattingOptions: {
        insertSpaces: false,
        tabSize: firstPostNewlineWhitespace.length,
      },
    };
  }
  return {};
}

function convertDiagnostic(d: Diagnostic): IdeDiagnostic {
  const converter = OffsetToPositionConverter.get(d.location.file);
  let relatedInformation: DiagnosticRelatedInformation[] | undefined;
  if (d.supplementalLocations) {
    relatedInformation = [];
    for (const loc of d.supplementalLocations) {
      relatedInformation.push({
        location: {
          uri: url.pathToFileURL(loc.location.file.path).toString(),
          range: converter.toIdeRange(loc.location.range),
        },
        message: loc.message,
      });
    }
  }
  return {
    severity: convertSeverity(d.severity),
    message: d.message,
    source: 'wireit',
    range: converter.toIdeRange(d.location.range),
    relatedInformation,
  };
}

function convertSeverity(
  severity: 'error' | 'warning' | 'info'
): DiagnosticSeverity {
  switch (severity) {
    case 'error':
      return 1; // DiagnosticSeverity.Error;
    case 'warning':
      return 2; // DiagnosticSeverity.Warning;
    case 'info':
      return 3; // DiagnosticSeverity.Information;
    default: {
      const never: never = severity;
      throw new Error(`Unexpected severity: ${String(never)}`);
    }
  }
}
