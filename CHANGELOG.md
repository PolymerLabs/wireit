# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic
Versioning](https://semver.org/spec/v2.0.0.html).

<!-- ## [Unreleased] -->

## [0.1.1] - 2022-04-08

### Added

- Added `WIREIT_CACHE` environment variable, which controls caching behavior.
  Can be `local` or `none` to disable.

- Added `if-file-deleted` option to the `clean` settings. In this mode,
  `output` files are deleted if any of the input files have been deleted since
  the last run.

### Changed

- In watch mode, the terminal is now cleared at the start of each run, making it
  easier to distinguish the latest output from previous output.

- In watch mode, a "Watching for file changes" message is now logged at the end
  of each run.

- A "Restored from cache" message is now logged when output was restored from
  cache.

- Caching is now disabled by default when the `CI` environment variable is
  `true`. This variable is automatically set by GitHub Actions and Travis. The
  `WIREIT_CACHE` environment variable takes precedence over this default.

## [0.1.0] - 2022-04-06

### Added

- Limit the number of scripts running at any one time. By default it's 4 \* the
  number of CPU cores. Use the environment variable WIREIT_PARALLEL to override
  this default. Set it to Infinity to go back to unbounded parallelism.

- Added local disk caching. If a script has both its `files` and `output` arrays
  defined, then the `output` files for each run will now be cached inside the
  `.wireit` directory. If a script runs with the same configuration and `files`,
  then the `output` files will be copied from the cache, instead of running the
  script's command.

### Changed

- [**Breaking**] Bumped minimum Node version from `16.0.0` to `16.7.0` in order
  to use `fs.cp`.

### Fixed

- Fixed bug where deleting a file would not trigger a re-run in watch mode.

- Fixed bug which caused `node_modules/` binaries to not be found when crossing
  package boundaries through dependencies.

## [0.0.0] - 2022-04-04

### Added

- Initial release.
