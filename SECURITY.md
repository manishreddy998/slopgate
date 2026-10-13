# Security

slopgate blocks suspicious package names. It does not inspect the code of an already-popular package, and it does not query a vulnerability database.

## Reporting

Open an issue at <https://github.com/manishreddy998/slopgate/issues> with the command that was about to run and the slopgate output. Do not include private registry credentials.

## Fail-open behavior

A crash, an unreadable hook payload, or invalid config does not block the install. slopgate prints the error and the client continues. Set `SLOPGATE_FAIL_CLOSED=1` in the hook environment to stop the command instead. `init` does not set that variable.

## Project config

`slopgate init` writes hooks into the project. Anything that can edit the project can also edit `slopgate.config.json` or the `slopgate` key in `package.json`.

`~/.config/slopgate/config.json` is applied after the project file. Numeric settings such as `blockScore` in the user file replace the project values. `allow` and `trustedScopes` are unioned, so a project entry of `"*"` still allows every name after the user file is read.

Set `SLOPGATE_IGNORE_PROJECT_CONFIG=1` on the hook process to skip the project file entirely.

Invalid JSON is left untouched. The hook then fails open, or closed if `SLOPGATE_FAIL_CLOSED=1`. `init` refuses to overwrite a file it cannot parse.
