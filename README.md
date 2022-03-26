<img src="wireit.svg" height="80" alt="wireit"/>

> Wireit upgrades your npm scripts to make them smarter and more efficient.

## Features

- 🙂 Use the `npm run` commands you already know
- 🛠️ Works with single packages, npm workspaces, and other monorepos
- ⛓️ Automatically run dependencies between npm scripts in parallel
- 👀 Watch any script and continuously re-run on changes
- 🥬 Skip scripts that are already fresh
- ♻️ Cache output locally and on GitHub Actions

## Contents

- [Features](#features)
- [Install](#install)
- [Setup](#setup)
- [Dependencies](#dependencies)
  - [Vanilla scripts](#vanilla-scripts)
  - [Cross-package dependencies](#cross-package-dependencies)
- [Incremental build](#incremental-build)
- [Glob patterns](#glob-patterns)
- [Requirements](#requirements)
- [Contributing](#contributing)

## Install

```sh
npm i -D wireit
```

## Setup

Wireit works _with_ `npm run`, it doesn't replace it. To configure an NPM script
for Wireit, move the command into a new `wireit` section of your `package.json`,
and replace the original script with the `wireit` command.

<table>
<tr>
<th>Before</th>
<th>After</th>
</tr>
<tr>
<td>
<pre lang="json">
{
  "scripts": {
    "build": "tsc"
  }
}
</pre>
</td>
<td>
<pre lang="json">
{
  "scripts": {
    "build": "wireit"
  },
  "wireit": {
    "build": {
      "command": "tsc"
    }
  }
}
</pre>
</td>
</tr>
</table>

Now when you run `npm run build`, Wireit upgrades the script to be smarter and
more efficient.

You should also add `.wireit` to your `.gitignore` file. Wireit uses the
`.wireit` directory to store caches and other data for your scripts.

```sh
echo .wireit >> .gitignore
```

## Dependencies

To declare a dependency between two scripts, edit the
`wireit.<script>.dependencies` list:

```json
{
  "scripts": {
    "build": "wireit",
    "bundle": "wireit"
  },
  "wireit": {
    "build": {
      "command": "tsc"
    },
    "bundle": {
      "command": "rollup -c",
      "dependencies": ["build"]
    }
  }
}
```

Now when you run `npm run bundle`, the `build` script will automatically run
first.

### Vanilla scripts

The scripts you depend on don't need to be configured for Wireit, they can be
vanilla `npm` scripts. This lets you only use Wireit for some of your scripts,
or to upgrade incrementally. Scripts that haven't been configured for Wireit are
always safe to use as dependencies; they just won't be fully optimized.

### Cross-package dependencies

Dependencies can refer to scripts in other npm packages by using a relative path
with the syntax `<relative-path>:<script-name>`. All cross-package dependencies
should start with a `"."`. Cross-package dependencies work well for npm
workspaces, as well as in other kinds of monorepos.

```json
{
  "scripts": {
    "build": "wireit"
  },
  "wireit": {
    "build": {
      "command": "tsc",
      "dependencies": ["../other-package:build"]
    }
  }
}
```

## Incremental build

Wireit can automatically skip execution of a script if nothing has changed that
would cause it to produce different output since the last time it ran. This is
called _incremental build_.

To enable incremental build, configure the input files for each script by
specifying [glob patterns](#glob-patterns) in the `wireit.<script>.files` list:

```json
{
  "scripts": {
    "build": "wireit",
    "bundle": "wireit"
  },
  "wireit": {
    "build": {
      "command": "tsc",
      "files": ["src/**/*.ts", "tsconfig.json"]
    },
    "bundle": {
      "command": "rollup -c",
      "dependencies": ["build"],
      "files": ["rollup.config.json"]
    }
  }
}
```

Now when you run `npm run bundle`:

- The `tsc` command is skipped if no changes are detected in the `.ts` or
  `tsconfig.json` files.
- The `rollup` command is skipped if no changes are detected in the
  `rollup.config.json` file, and if no changes were detected in the input files
  to `tsc`.

Notes:

- If a script doesn't have a `files` list defined at all, then it will _always_
  run, because Wireit doesn't know which files to check for changes. To tell
  Wireit it is safe to skip execution of a script that definitely has no input
  files, set `files` to an empty array (`files: []`).

- In addition to the `files` list, the following also determine whether a script
  will be skipped or not:
  - The `command` must not have changed.
  - The `files` of all transitive dependencies must not have changed.
  - All transitive dependencies must have `files` defined (can be empty).

## Glob patterns

The following glob syntaxes are supported in the `files` array:

| Example         | Description                                                                    |
| --------------- | ------------------------------------------------------------------------------ |
| `foo`           | The file named `foo`.                                                          |
| `foo/*`         | All files directly in the `foo/` directory.                                    |
| `foo/**/*`      | All files in the `foo/` directory, and in any of its recursive subdirectories. |
| `foo.{html,js}` | Files named `foo.html` or `foo.js`.                                            |
| `!foo`          | Exclude the file `foo` from previous matches.                                  |

Also note these details:

- Hidden/dot files are matched by `*` and `**`.
- Patterns are case-sensitive (if supported by the filesystem).

## Requirements

Wireit is supported on Linux, macOS, and Windows.

Wireit requires Node Active LTS (16) or Current (17). Node Maintenance LTS
releases are not supported. See [here](https://nodejs.org/en/about/releases/)
for Node's release schedule.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md)
