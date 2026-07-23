'use strict'

const { randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const {
  STYLE_TEMPLATE_SCHEMA_VERSION,
  canonicalizeStyleTemplateName,
  decodeStyleTemplateFile,
} = require('./style-template-schema.cjs')
const { readUtf8FileWithinLimit, writeUtf8FileAtomically } = require('./project-files.cjs')

const MAX_STYLE_TEMPLATE_FILE_BYTES = 1024 * 1024

function isErrnoException(error, code) {
  return error !== null && typeof error === 'object' && error.code === code
}

function emptyFile() {
  return { templates: [] }
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

function publicTemplate(template) {
  return {
    id: template.id,
    name: template.name,
    preferences: template.preferences,
  }
}

function decodeStoredFile(json) {
  let source
  try {
    source = JSON.parse(json)
  } catch (error) {
    throw new SyntaxError(
      `Invalid style template JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const root = requireExactKeys(
    source,
    ['schemaVersion', 'templates', 'backgroundAuthorizations'],
    'styleTemplates',
  )
  if (root.schemaVersion !== STYLE_TEMPLATE_SCHEMA_VERSION) {
    throw new Error('Unsupported style template store format. Expected schemaVersion 0.')
  }
  const decoded = decodeStyleTemplateFile({
    schemaVersion: STYLE_TEMPLATE_SCHEMA_VERSION,
    templates: root.templates,
  })
  if (!Array.isArray(root.backgroundAuthorizations)) {
    throw new TypeError('styleTemplates.backgroundAuthorizations must be an array.')
  }
  const authorizations = new Map()
  for (const value of root.backgroundAuthorizations) {
    const authorization = requireExactKeys(
      value,
      ['id', 'path'],
      'styleTemplates.backgroundAuthorizations[]',
    )
    const id = requireId(authorization.id, 'styleTemplates.backgroundAuthorizations[].id')
    if (typeof authorization.path !== 'string' || !authorization.path) {
      throw new TypeError('styleTemplates.backgroundAuthorizations[].path must be a string.')
    }
    if (authorizations.has(id))
      throw new Error(`Duplicate style template background authorization: ${id}`)
    authorizations.set(id, authorization.path)
  }
  const templates = decoded.templates.map((template) => {
    const imagePath = template.preferences.stageStyle.background.imagePath
    const isImage = template.preferences.stageStyle.background.mode === 'image'
    const authorizedPath = authorizations.get(template.id) ?? null
    if ((isImage && authorizedPath !== imagePath) || (!isImage && authorizedPath !== null)) {
      throw new Error(`Invalid style template background authorization: ${template.id}`)
    }
    return { ...template, backgroundImagePath: authorizedPath }
  })
  if (
    authorizations.size !==
    templates.filter(({ backgroundImagePath }) => backgroundImagePath).length
  ) {
    throw new Error('Style template background authorization references an unknown template.')
  }
  return { templates }
}

function serializeStoredFile(value) {
  const templates = value.templates.map(publicTemplate)
  const decoded = decodeStyleTemplateFile({
    schemaVersion: STYLE_TEMPLATE_SCHEMA_VERSION,
    templates,
  })
  const backgroundAuthorizations = value.templates.flatMap((template, index) => {
    const background = decoded.templates[index].preferences.stageStyle.background
    if (background.mode !== 'image') {
      if (template.backgroundImagePath !== null)
        throw new Error('Non-image templates cannot retain background authorization.')
      return []
    }
    if (template.backgroundImagePath !== background.imagePath) {
      throw new Error('Image templates require a matching main-authorized background path.')
    }
    return [{ id: decoded.templates[index].id, path: template.backgroundImagePath }]
  })
  return JSON.stringify({
    schemaVersion: STYLE_TEMPLATE_SCHEMA_VERSION,
    templates: decoded.templates,
    backgroundAuthorizations,
  })
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
    return decodeStoredFile(json)
  }

  async function persist(value) {
    const json = serializeStoredFile(value)
    if (Buffer.byteLength(json, 'utf8') > MAX_STYLE_TEMPLATE_FILE_BYTES) {
      throw new RangeError('Style template file exceeds the 1 MB limit.')
    }
    await writeFile(filePath, json)
    return decodeStoredFile(json)
  }

  return Object.freeze({
    list() {
      return enqueue(async () => (await readCurrent()).templates.map(publicTemplate))
    },

    find(value) {
      return enqueue(async () => {
        const request = requireExactKeys(value, ['id'], 'findStyleTemplate')
        const id = requireId(request.id)
        const template = (await readCurrent()).templates.find((candidate) => candidate.id === id)
        return template ? publicTemplate(template) : null
      })
    },

    findAuthorized(value) {
      return enqueue(async () => {
        const request = requireExactKeys(value, ['id'], 'findAuthorizedStyleTemplate')
        const id = requireId(request.id)
        const template = (await readCurrent()).templates.find((candidate) => candidate.id === id)
        return template ?? null
      })
    },

    authorizedBackgroundPaths() {
      return enqueue(
        async () =>
          new Set(
            (await readCurrent()).templates.flatMap(({ backgroundImagePath }) =>
              backgroundImagePath ? [backgroundImagePath] : [],
            ),
          ),
      )
    },

    create(value, { authorizeBackgroundPath = () => false } = {}) {
      return enqueue(async () => {
        if (typeof authorizeBackgroundPath !== 'function') {
          throw new TypeError('authorizeBackgroundPath must be a function.')
        }
        const request = requireExactKeys(value, ['name', 'preferences'], 'createStyleTemplate')
        const name = canonicalizeStyleTemplateName(request.name, 'createStyleTemplate.name')
        const current = await readCurrent()
        if (current.templates.some((template) => template.name === name)) {
          throw new Error(`Duplicate style template name: ${name}`)
        }
        const publicValue = decodeStyleTemplateFile({
          schemaVersion: STYLE_TEMPLATE_SCHEMA_VERSION,
          templates: [
            {
              id: requireId(createId(), 'Generated style template id'),
              name,
              preferences: request.preferences,
            },
          ],
        }).templates[0]
        const imagePath = publicValue.preferences.stageStyle.background.imagePath
        let backgroundImagePath = null
        if (publicValue.preferences.stageStyle.background.mode === 'image') {
          if ((await authorizeBackgroundPath(imagePath)) !== true) {
            throw new Error('The linked background image is not authorized by Studio.')
          }
          backgroundImagePath = imagePath
        }
        const template = { ...publicValue, backgroundImagePath }
        await persist({ ...current, templates: [...current.templates, template] })
        return publicTemplate(template)
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
        return publicTemplate(persisted.templates[index])
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
