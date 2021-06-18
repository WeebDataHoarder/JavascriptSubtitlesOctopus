Module = Module || {}

Module.preRun = Module.preRun || []

Module.preRun.push(function () {
  let i
  Module.FS_createFolder('/', 'fonts', true, true)
  Module.FS_createFolder('/', '.fontconfig', true, true)

  // We can use sync xhr cause we're inside Web Worker
  if (!self.subContent) self.subContent = read_(self.subUrl)

  let result
  {
    /* eslint prefer-regex-literals: 0 */
    /* eslint no-control-regex: 0 */
    // shit crashes if regex is done correctly, thanks emscripten
    const regex = new RegExp('^fontname((v2:[ \t]*(?<fontName2>[^_]+)_(?<fontProperties2>[^,]*).(?<fontExtension2>[a-z0-9]{3,5}),[ \t]*(?<fontContent2>.+)$)|(:[ \t]*(?<fontName>[^_]+)_(?<fontProperties>[^$]*).(?<fontExtension>[a-z0-9]{3,5})(?<fontContent>(?:\r?\n[\x21-\x60]+)+)))', 'mg')
    while ((result = regex.exec(self.subContent)) !== null) {
      let font
      if ('fontName2' in result.groups && result.groups.fontName2 !== undefined) {
        font = {
          content: self.readDataUri(result.groups.fontContent2),
          id: result.groups.fontName2,
          name: result.groups.fontName2 + '.' + result.groups.fontExtension2
        }
      } else {
        font = {
          content: self.decodeASSFontEncoding(result.groups.fontContent),
          id: result.groups.fontName2,
          name: result.groups.fontName + '.' + result.groups.fontExtension
        }
      }

      self.fontMap_[font.id] = true
      Module.FS.writeFile('/fonts/font' + (self.fontId++) + '-' + font.name, font.content, { encoding: 'binary' })
      console.log('libass: attaching embedded font ' + font.name)
    }
  }

  if ((self.availableFonts && self.availableFonts.length !== 0)) {
    for (const selection of parseAss(self.subContent)) {
      for (const key of selection.body) {
        if (key === 'Style') self.writeFontToFS(key.value.Fontname)
      }
    }

    const regex = /\\fn([^\\}]*?)[\\}]/g
    let matches
    while ((matches = regex.exec(self.subContent)) !== null) self.writeFontToFS(matches[1])
  }

  if (self.subContent) Module.FS.writeFile('/sub.ass', self.subContent)

  self.subContent = null

  if (self.fallbackFont) Module[(self.lazyFontLoading && self.fallbackFont.indexOf('blob:') !== 0) ? 'FS_createLazyFile' : 'FS_createPreloadedFile']('/fonts', '.fallback-' + self.fallbackFont.split('/').pop(), self.fallbackFont, true, false)

  for (const file of self.fontFiles || []) Module[(self.lazyFontLoading && file.indexOf('blob:') !== 0) ? 'FS_createLazyFile' : 'FS_createPreloadedFile']('/fonts', 'font' + i + '-' + file.split('/').pop(), file, true, false)
})

Module.onRuntimeInitialized = function () {
  self.octObj = new Module.SubtitleOctopus()

  self.changed = Module._malloc(4)

  if (self.debug) self.octObj.setLogLevel(7)
  self.octObj.initLibrary(screen.width, screen.height, self.fallbackFont ? '/fonts/.fallback-' + self.fallbackFont.split('/').pop() : '/default.woff2')
  self.octObj.setDropAnimations(!!self.dropAllAnimations)
  self.octObj.createTrack('/sub.ass')
  self.ass_track = self.octObj.track
  self.ass_library = self.octObj.ass_library
  self.ass_renderer = self.octObj.ass_renderer

  if (self.libassMemoryLimit > 0 || self.libassGlyphLimit > 0) self.octObj.setMemoryLimits(self.libassGlyphLimit, self.libassMemoryLimit)
}

Module.print = function (text) {
  if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' ')
  console.log(text)
}
Module.printErr = function (text) {
  if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' ')
  console.error(text)
}

Module.print = function (text) {
  if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' ')
  console.log(text)
}
Module.printErr = function (text) {
  if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' ')
  console.error(text)
}
