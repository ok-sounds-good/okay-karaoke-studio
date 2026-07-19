module.exports.countSungPixels = function countSungPixels(decoded, dominance = 10) {
  let lyricPixels = 0
  for (let pixel = 0; pixel < decoded.length; pixel += 3) {
    const [r, g, b] = decoded.subarray(pixel, pixel + 3)
    if (r >= 100 && b >= 100 && r - g >= dominance && b - g >= dominance) lyricPixels += 1
  }
  return lyricPixels
}
