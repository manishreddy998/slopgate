# Security

slopgate blocks suspicious package names. It does not inspect the code of a package that is already popular, and it does not query a vulnerability database.

## Reporting

Open an issue at <https://github.com/manishreddy998/slopgate/issues> with the command the agent tried to run and the slopgate output. Do not include private registry tokens.

## Fail open

A crash, a broken hook payload, or an unreadable config does not block the install. The agent prints the error and continues. Set `SLOPGATE_FAIL_CLOSED=1` in the hook environment when a failure should stop the command instead. `init` does not set that variable.

## Project config

`slopgate init` writes hooks into the project. An agent that can edit the project can also edit `slopgate.config.json` or the `slopgate` key in `package.json`.

`~/.config/slopgate/config.json` is applied after the project file. Numbers such as `blockScore` in the user file replace the project values. `allow` and `trustedScopes` are unioned, so a project entry of `"*"` still allows every name after the user file is read.

Set `SLOPGATE_IGNORE_PROJECT_CONFIG=1` for the hook process when the project file should not be read at all. That is the setting that keeps an agent from allowlisting itself.

Invalid JSON is left untouched and the hook fails open (or closed, if you asked for that). `init` will not overwrite a file it cannot parse.
