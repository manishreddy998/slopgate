# Security

slopgate blocks suspicious package names. It does not read the code of a package that is already famous, and it does not look up a list of known bugs.

## Reporting

Open an issue at <https://github.com/manishreddy998/slopgate/issues>. Include the command the tool tried to run, and the slopgate output. Do not include private registry tokens.

## When slopgate crashes

A crash, a broken hook message, or a settings file that cannot be read does not block the install. The tool prints the error and continues. Set `SLOPGATE_FAIL_CLOSED=1` in the hook environment when a failure should stop the command instead. `init` does not set that variable.

## Project settings

`slopgate init` writes hooks into the project. A coding tool that can edit the project can also edit `slopgate.config.json`, or the `slopgate` key in `package.json`.

`~/.config/slopgate/config.json` is applied after the project file. Numbers such as `blockScore` in the user file replace the project values. `allow` and `trustedScopes` are added together, so a project entry of `"*"` still allows every name after the user file is read.

Set `SLOPGATE_IGNORE_PROJECT_CONFIG=1` for the hook when the project file should not be read at all. That is the setting that stops a coding tool from allowing its own installs.

Broken JSON is left as it is. The hook then lets the install continue, or stops it if you asked for that. `init` will not overwrite a file it cannot parse.
