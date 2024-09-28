# Wireit Cache Validate

Validate if Wireit script is fully cached with subsequent runs. Run `wireit-cache-validate` after your
wireit script to check if all files are cached successfully. This helps ensure that your build is
consistent and reproducible.

## Installation

```shell
npm i wireit-cache-validate --save-dev
```

```json
"scripts": {
  "build": "wireit"
},
"wireit": {
  "build": {
    "command": "tsc",
    "files": [
      "src/index.ts"
    ],
    "output": [
      "dist/index.js"
    ]
  }
},
```


```shell
npm run build && wireit-cache-validate npm run build
```

### Success

```shell
✅ Ran 0 scripts and skipped 1 in 0s.
✅ Cache validation passed.
```

### Failure

```shell
🚫 Cache validation failed. Check .wireit-cache-validate log to verify all scripts are cached correctly.
https://github.com/google/wireit?tab=readme-ov-file#caching
```

If a cache check fails a `.wireit-cache-validate` file will be created in the root of your project. This file
will contain the logs of the failed cache check. You can use this file to debug why the cache check failed.
