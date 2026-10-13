import type { Ecosystem } from '../types.js'
import { collapseRepeats, homoglyphKey, separatorKey } from './distance.js'

/** A hand-picked list, not a download of every package. Order is a rough popularity rank, used only to break ties. */
const NPM = [
  'react', 'react-dom', 'react-router', 'react-router-dom', 'react-codemod', 'jscodeshift',
  'scheduler', 'prop-types', 'preact', 'vue', 'vue-router', 'vuex', 'pinia', 'svelte', '@sveltejs/kit',
  'solid-js', 'next', 'nuxt', 'rxjs', 'redux', '@reduxjs/toolkit', 'react-redux', 'zustand', 'jotai',
  'mobx', 'immer', 'lodash', 'underscore', 'ramda', 'axios', 'node-fetch', 'got', 'ky', 'express',
  'fastify', 'koa', 'hono', '@nestjs/core', '@nestjs/common', 'cors', 'body-parser', 'cookie-parser',
  'jsonwebtoken', 'bcrypt', 'bcryptjs', 'passport', 'helmet', 'morgan', 'dotenv', 'zod', 'joi', 'yup',
  'ajv', 'typescript', 'tslib', '@types/node', '@types/react', '@types/react-dom', 'eslint', 'prettier',
  'jest', 'mocha', 'chai', 'vitest', '@testing-library/react', 'playwright', '@playwright/test',
  'puppeteer', 'cypress', 'webpack', 'vite', 'esbuild', 'rollup', 'parcel', '@babel/core', 'core-js',
  'postcss', 'tailwindcss', 'sass', 'autoprefixer', 'chalk', 'debug', 'commander', 'yargs', 'inquirer',
  'ora', 'semver', 'glob', 'minimatch', 'fs-extra', 'rimraf', 'uuid', 'nanoid', 'ms', 'moment', 'dayjs',
  'date-fns', 'luxon', 'classnames', 'clsx', 'styled-components', '@emotion/react', 'framer-motion',
  'mongoose', 'pg', 'mysql2', 'redis', 'ioredis', '@prisma/client', 'prisma', 'drizzle-orm', 'knex',
  'sequelize', 'typeorm', 'graphql', '@apollo/client', 'ws', 'socket.io', 'nodemailer', 'stripe',
  'openai', '@tanstack/react-query', 'swr', 'three', 'd3', 'chart.js', 'jquery', 'sharp', 'multer',
  'qs', 'react-hook-form', 'react-icons', 'lucide-react', 'tailwind-merge', 'class-variance-authority',
  'ejs', 'marked', 'markdown-it', 'js-yaml', 'yaml', 'pino', 'winston', 'sinon', 'nock', 'msw',
  'supertest', 'react-scripts', 'create-next-app', 'create-vite', '@angular/core', '@angular/cli',
  'lit', 'bootstrap', 'i18next', 'react-i18next', 'validator', 'jose', 'express-session', 'cookie',
  'pm2', 'nodemon', 'ts-node', 'tsx', 'tsup', 'concurrently', 'left-pad', 'husky', 'lint-staged',
  'turbo', 'nx', 'electron', 'react-native', 'mongodb', 'better-sqlite3', 'argon2', 'node-cron',
  'bullmq', 'firebase', 'firebase-admin', 'langchain', 'valibot', 'webpack-cli', 'css-loader',
  'html-webpack-plugin', 'eslint-config-prettier', 'eslint-plugin-react', 'eslint-plugin-react-hooks',
  '@typescript-eslint/parser', '@typescript-eslint/eslint-plugin', 'storybook', 'gulp', 'request',
  'bluebird', 'async', 'minimist', 'mkdirp', 'resolve', 'source-map', 'regenerator-runtime',
  'cross-fetch', 'form-data', 'mime-types', 'serve-static', 'http-errors', 'safe-buffer',
  '@babel/parser', '@babel/traverse', '@babel/generator', 'recast', 'ast-types', '@swc/core', 'terser',
  'webpack-dev-server', 'serve', 'express-validator', 'passport-jwt', 'express-rate-limit',
  'compression', 'dotenv-expand', 'cosmiconfig', 'redux-thunk', 'redux-saga', 'reselect', 'history',
  'query-string', 'socket.io-client', 'graphql-tag', 'apollo-server', 'handlebars', 'pug', 'nunjucks',
  'ini', 'lerna', 'is-odd', 'kind-of', 'react-is', 'loose-envify', 'gatsby', '@remix-run/react',
  'recharts', 'backbone', 'ember-source', 'polka', 'restify', 'jimp', 'pdfkit', 'mustache', 'toml',
  'ava', 'tap', 'less', 'stylus', 'csstype', 'pino-pretty', 'log4js', 'nconf', 'convict', 'superagent',
  'mysql', 'sqlite3', 'engine.io', 'shortid', 'cuid', 'crypto-js', 'moment-timezone', 'ansi-styles',
  'supports-color', 'wrap-ansi', 'string-width', 'globby', 'fast-glob', 'micromatch', 'readable-stream',
  'through2', 'graceful-fs', 'browserify', 'grunt', 'live-server', 'http-server', 'busboy', 'formidable',
  'csurf', 'hpp', 'bunyan', 'config', 'io-ts', 'immutable', 'normalizr', 'url-parse', '@sendgrid/mail',
  '@aws-sdk/client-s3', 'aws-sdk', '@langchain/core', 'ai', 'class-validator', 'reflect-metadata',
  'style-loader', 'postcss-loader', 'sass-loader', '@storybook/react', '@codemod/codemod',
]

const PYPI = [
  'requests', 'urllib3', 'certifi', 'charset-normalizer', 'idna', 'pip', 'setuptools', 'wheel',
  'packaging', 'numpy', 'pandas', 'scipy', 'matplotlib', 'scikit-learn', 'pillow', 'flask', 'django',
  'fastapi', 'uvicorn', 'starlette', 'pydantic', 'sqlalchemy', 'pytest', 'black', 'ruff', 'mypy',
  'click', 'rich', 'httpx', 'aiohttp', 'beautifulsoup4', 'lxml', 'pyyaml', 'python-dotenv', 'celery',
  'redis', 'boto3', 'botocore', 'cryptography', 'jinja2', 'werkzeug', 'gunicorn', 'typer', 'tqdm',
  'six', 'attrs', 'typing-extensions', 'anyio', 'pydantic-core', 'pluggy', 'iniconfig', 'tomli',
  'filelock', 'platformdirs', 'virtualenv', 'colorama', 'markupsafe', 'itsdangerous', 'alembic',
  'psycopg', 'psycopg2-binary', 'pymysql', 'torch', 'torchvision', 'tensorflow', 'transformers',
  'huggingface-hub', 'tokenizers', 'openai', 'anthropic', 'langchain', 'tiktoken', 'seaborn', 'plotly',
  'networkx', 'sympy', 'nltk', 'spacy', 'scrapy', 'selenium', 'playwright', 'hypothesis', 'coverage',
  'sphinx', 'mkdocs', 'loguru', 'sentry-sdk', 'orjson', 'ujson', 'python-dateutil', 'pytz', 'tox',
  'nox', 'isort', 'flake8', 'pylint', 'pyright', 'djangorestframework', 'django-cors-headers', 'kombu',
  'pymongo', 'peewee', 'greenlet', 'gevent', 'twisted', 'tornado', 'httpie', 'protobuf', 'grpcio',
  'structlog', 'pygments', 'markdown', 'faker', 'pytest-cov', 'pytest-asyncio', 'responses', 'freezegun',
  'pre-commit', 'importlib-metadata', 'zipp', 'pathspec', 'email-validator', 'passlib', 'python-jose',
  'authlib', 'polars', 'pyarrow', 'xgboost', 'lightgbm', 'keras', 'jax', 'safetensors', 'sentencepiece',
  'chromadb', 'llama-index', 'groq', 'cohere', 'marshmallow', 'cattrs', 'simplejson', 'toml',
  'python-multipart', 'uvloop', 'httptools', 'watchfiles', 'websockets', 'asyncpg', 'databases',
  'paramiko', 'fabric', 'invoke', 'boto3', 's3transfer', 'google-auth', 'cachetools', 'rsa',
]

const CARGO = [
  'serde', 'serde_json', 'tokio', 'reqwest', 'clap', 'anyhow', 'thiserror', 'rand', 'regex', 'log',
  'env_logger', 'tracing', 'tracing_subscriber', 'bytes', 'futures', 'async_trait', 'chrono', 'uuid',
  'once_cell', 'lazy_static', 'syn', 'quote', 'proc_macro2', 'libc', 'openssl', 'native_tls', 'rustls',
  'hyper', 'axum', 'actix_web', 'rocket', 'warp', 'sqlx', 'diesel', 'rusqlite', 'redis', 'image',
  'rayon', 'crossbeam', 'parking_lot', 'dashmap', 'indexmap', 'hashbrown', 'ahash', 'smallvec',
  'bitflags', 'num_traits', 'hex', 'base64', 'sha2', 'hmac', 'jsonwebtoken', 'tempfile', 'which',
  'indicatif', 'colored', 'url', 'http', 'mime', 'time', 'walkdir', 'glob', 'toml', 'dotenvy', 'tower',
  'tonic', 'prost', 'itertools', 'either', 'memchr', 'aho_corasick', 'ryu', 'itoa', 'serde_derive',
  'ripgrep', 'fd_find', 'bat', 'criterion', 'insta', 'pretty_assertions', 'mockall', 'wiremock',
  'cookie', 'headers', 'http_body', 'pin_project', 'futures_util', 'async_stream', 'humantime',
  'config', 'figment', 'serde_yaml', 'csv', 'ctrlc', 'console', 'dialoguer', 'nix', 'openssl_sys',
]

const GO = [
  'github.com/gin-gonic/gin', 'github.com/gorilla/mux', 'github.com/gorilla/websocket',
  'github.com/labstack/echo', 'github.com/go-chi/chi', 'github.com/gofiber/fiber',
  'github.com/spf13/cobra', 'github.com/spf13/viper', 'github.com/spf13/pflag',
  'github.com/stretchr/testify', 'github.com/sirupsen/logrus', 'go.uber.org/zap',
  'golang.org/x/crypto', 'golang.org/x/sync', 'golang.org/x/net', 'golang.org/x/sys',
  'golang.org/x/text', 'golang.org/x/tools', 'github.com/pkg/errors', 'github.com/joho/godotenv',
  'github.com/google/uuid', 'github.com/golang-jwt/jwt', 'github.com/dgrijalva/jwt-go',
  'gorm.io/gorm', 'github.com/go-sql-driver/mysql', 'github.com/jackc/pgx', 'github.com/lib/pq',
  'github.com/redis/go-redis', 'github.com/go-redis/redis', 'k8s.io/client-go',
  'github.com/prometheus/client_golang', 'google.golang.org/grpc', 'google.golang.org/protobuf',
  'github.com/aws/aws-sdk-go', 'github.com/aws/aws-sdk-go-v2', 'github.com/rs/zerolog',
  'github.com/fatih/color', 'github.com/mitchellh/mapstructure', 'go.mongodb.org/mongo-driver',
  'github.com/valyala/fasthttp', 'gopkg.in/yaml.v3', 'github.com/BurntSushi/toml',
  'github.com/fsnotify/fsnotify', 'github.com/google/go-cmp', 'github.com/urfave/cli',
  'github.com/go-playground/validator', 'github.com/jmoiron/sqlx', 'github.com/golang-migrate/migrate',
  'github.com/json-iterator/go', 'github.com/pelletier/go-toml',
]

const RAW: Record<Ecosystem, readonly string[]> = {
  npm: NPM,
  pypi: PYPI,
  cargo: CARGO,
  go: GO,
}

export interface PopularEntry {
  name: string
  key: string
  rank: number
  stripped: string
  homoglyph: string
  collapsed: string
  lastSegment: string
  parent: string
}

export function compareKey(ecosystem: Ecosystem, name: string): string {
  const lower = name.toLowerCase()
  if (ecosystem === 'pypi') return lower.replace(/[-_.]+/g, '-')
  if (ecosystem === 'cargo') return lower.replace(/-/g, '_')
  return lower
}

function finalize(ecosystem: Ecosystem, names: readonly string[]): PopularEntry[] {
  const seen = new Set<string>()
  const entries: PopularEntry[] = []
  for (const name of names) {
    const key = compareKey(ecosystem, name)
    if (seen.has(key)) continue
    seen.add(key)
    const segments = key.split('/')
    const lastSegment = segments[segments.length - 1] ?? key
    entries.push({
      name,
      key,
      rank: entries.length,
      stripped: separatorKey(key),
      homoglyph: homoglyphKey(key),
      collapsed: collapseRepeats(key),
      lastSegment,
      parent: segments.slice(0, -1).join('/'),
    })
  }
  return entries
}

const INDEX: Record<Ecosystem, PopularEntry[]> = {
  npm: finalize('npm', NPM),
  pypi: finalize('pypi', PYPI),
  cargo: finalize('cargo', CARGO),
  go: finalize('go', GO),
}

const BY_KEY: Record<Ecosystem, Map<string, PopularEntry>> = {
  npm: new Map(INDEX.npm.map((entry) => [entry.key, entry])),
  pypi: new Map(INDEX.pypi.map((entry) => [entry.key, entry])),
  cargo: new Map(INDEX.cargo.map((entry) => [entry.key, entry])),
  go: new Map(INDEX.go.map((entry) => [entry.key, entry])),
}

export function popularEntries(ecosystem: Ecosystem): readonly PopularEntry[] {
  return INDEX[ecosystem]
}

export function popularEntry(ecosystem: Ecosystem, name: string): PopularEntry | undefined {
  return BY_KEY[ecosystem].get(compareKey(ecosystem, name))
}

export function isPopular(ecosystem: Ecosystem, name: string): boolean {
  return BY_KEY[ecosystem].has(compareKey(ecosystem, name))
}

export const POPULAR_LISTS = RAW
