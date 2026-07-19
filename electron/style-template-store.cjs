'use strict'

const { randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const {
  STYLE_TEMPLATE_SCHEMA_VERSION,
  canonicalizeStyleTemplateName,
  decodeStyleTemplateFile,
  parseStyleTemplateJson,
  serializeStyleTemplateFile,
} = require('./style-template-schema.cjs')
const { readUtf8FileWithinLimit, writeUtf8FileAtomically } = require('./project-files.cjs')

const MAX_STYLE_TEMPLATE_FILE_BYTES = 1024 * 1024

function isErrnoException(error, code) {
  return error !== null && typeof error === 'object' && error.code === code
}

function emptyFile() {
  return { schemaVersion: STYLE_TEMPLATE_SCHEMA_VERSION, templates: [] }
}

function requireRecord(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`)
  }
  return value
}

function requireExactKeys(value, expected, label) {
  const source = requireRecord(value, label)
  for (const key in source) {
    if (!Object.hasOwn(source, key)) {
      throw new TypeError(`${label}.${key} must be an own property.`)
    }
  }
  const keys = Object.keys(source)
  if (keys.length !== expected.length || expected.some((key) => !Object.hasOwn(source, key))) {
    throw new TypeError(`${label} has an invalid shape.`)
  }
  return source
}

function requireId(value, label = 'id') {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,128}$/u.test(value)) {
    throw new TypeError(`${label} must be 1 to 128 printable non-space ASCII characters.`)
  }
  return value
}

function createStyleTemplateStore({
  filePath,
  createId = randomUUID,
  readFile = readUtf8FileWithinLimit,
  writeFile = writeUtf8FileAtomically,
} = {}) {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    throw new TypeError('Style template store requires a file path.')
  }
  if (
    typeof createId !== 'function' ||
    typeof readFile !== 'function' ||
    typeof writeFile !== 'function'
  ) {
    throw new TypeError('Style template store dependencies must be functions.')
  }

  let tail = Promise.resolve()

  function enqueue(operation) {
    const pending = tail.catch(() => {}).then(operation)
    tail = pending
    return pending
  }

  async function readCurrent() {
    let json
    try {
      json = await readFile(filePath, MAX_STYLE_TEMPLATE_FILE_BYTES, 'Style template file')
    } catch (error) {
      if (isErrnoException(error, 'ENOENT')) return emptyFile()
      throw error
    }
    return parseStyleTemplateJson(json)
  }

  async function persist(value) {
    const json = serializeStyleTemplateFile(value)
    if (Buffer.byteLength(json, 'utf8') > MAX_STYLE_TEMPLATE_FILE_BYTES) {
      throw new RangeError('Style template file exceeds the 1 MB limit.')
    }
    await writeFile(filePath, json)
    return decodeStyleTemplateFile(value)
  }

  return Object.freeze({
    list() {
      return enqueue(async () => (await readCurrent()).templates)
    },

    create(value) {
      return enqueue(async () => {
        const request = requireExactKeys(value, ['name', 'preferences'], 'createStyleTemplate')
        const name = canonicalizeStyleTemplateName(request.name, 'createStyleTemplate.name')
        const current = await readCurrent()
        if (current.templates.some((template) => template.name === name)) {
          throw new Error(`Duplicate style template name: ${name}`)
        }
        const template = decodeStyleTemplateFile({
          schemaVersion: STYLE_TEMPLATE_SCHEMA_VERSION,
          templates: [
            {
              id: requireId(createId(), 'Generated style template id'),
              name,
              preferences: request.preferences,
            },
          ],
        }).templates[0]
        await persist({ ...current, templates: [...current.templates, template] })
        return template
      })
    },

    rename(value) {
      return enqueue(async () => {
        const request = requireExactKeys(value, ['id', 'name'], 'renameStyleTemplate')
        const id = requireId(request.id)
        const name = canonicalizeStyleTemplateName(request.name, 'renameStyleTemplate.name')
        const current = await readCurrent()
        const index = current.templates.findIndex((template) => template.id === id)
        if (index < 0) throw new Error('Style template not found.')
        if (
          current.templates.some(
            (template, candidate) => candidate !== index && template.name === name,
          )
        ) {
          throw new Error(`Duplicate style template name: ${name}`)
        }
        const templates = current.templates.map((template, candidate) =>
          candidate === index ? { ...template, name } : template,
        )
        const persisted = await persist({ ...current, templates })
        return persisted.templates[index]
      })
    },

    delete(value) {
      return enqueue(async () => {
        const request = requireExactKeys(value, ['id'], 'deleteStyleTemplate')
        const id = requireId(request.id)
        const current = await readCurrent()
        const index = current.templates.findIndex((template) => template.id === id)
        if (index < 0) throw new Error('Style template not found.')
        await persist({
          ...current,
          templates: current.templates.filter((_template, candidate) => candidate !== index),
        })
        return true
      })
    },
  })
}

module.exports = {
  MAX_STYLE_TEMPLATE_FILE_BYTES,
  createStyleTemplateStore,
}
