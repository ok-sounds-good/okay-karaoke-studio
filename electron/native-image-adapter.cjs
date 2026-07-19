'use strict'

function createNativeImageDecoder(nativeImage) {
  if (!nativeImage || typeof nativeImage.createFromBuffer !== 'function') {
    throw new TypeError('A nativeImage implementation is required')
  }

  return function decodeNativeImage(bytes) {
    const image = nativeImage.createFromBuffer(bytes)
    if (!image || typeof image.isEmpty !== 'function' || typeof image.getSize !== 'function')
      return false
    if (image.isEmpty()) return { empty: true, height: 0, width: 0 }
    const size = image.getSize()
    return {
      empty: false,
      height: size?.height,
      width: size?.width,
    }
  }
}

function createElectronNativeImageDecoder() {
  // Keep Electron out of Node unit tests; production binds it only on demand.
  const { nativeImage } = require('electron')
  return createNativeImageDecoder(nativeImage)
}

module.exports = { createElectronNativeImageDecoder, createNativeImageDecoder }
