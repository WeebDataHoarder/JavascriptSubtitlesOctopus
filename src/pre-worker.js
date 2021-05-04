Module = Module || {}

Module.preRun = Module.preRun || []

Module.preRun.push(function () {
  let i
  Module.FS_createFolder('/', 'fonts', true, true)
  Module.FS_createFolder('/', '.fontconfig', true, true)

  if (!self.subContent) {
    // We can use sync xhr cause we're inside Web Worker
    self.subContent = read_(self.subUrl)
  }

  let result
  {
    const regex = new RegExp('^fontname((v2:[ \t]*(?<fontName2>[^_]+)_(?<fontProperties2>[^,]*)\.(?<fontExtension2>[a-z0-9]{3,5}),[ \t]*(?<fontContent2>.+)$)|(:[ \t]*(?<fontName>[^_]+)_(?<fontProperties>[^$]*)\.(?<fontExtension>[a-z0-9]{3,5})(?<fontContent>(?:\r?\n[\x21-\x60]+)+)))', 'mg')
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
      Module.FS.writeFile('/fonts/font' + (self.fontId++) + '-' + font.name, font.content, {
        encoding: 'binary'
      })
      console.log('libass: attaching embedded font ' + font.name)
    }
  }

  if ((self.availableFonts && self.availableFonts.length !== 0)) {
    const sections = parseAss(self.subContent)
    for (i = 0; i < sections.length; i++) {
      for (let j = 0; j < sections[i].body.length; j++) {
        if (sections[i].body[j].key === 'Style') {
          self.writeFontToFS(sections[i].body[j].value.Fontname)
        }
      }
    }

    const regex = /\\fn([^\\}]*?)[\\}]/g
    let matches
    while (matches = regex.exec(self.subContent)) {
      self.writeFontToFS(matches[1])
    }
  }

  if (self.subContent) {
    Module.FS.writeFile('/sub.ass', self.subContent)
  }

  self.subContent = null

  if (self.fallbackFont) {
    Module[(self.lazyFontLoading && self.fallbackFont.indexOf('blob:') !== 0) ? 'FS_createLazyFile' : 'FS_createPreloadedFile']('/fonts', '.fallback-' + self.fallbackFont.split('/').pop(), self.fallbackFont, true, false)
    }

  const fontFiles = self.fontFiles || []
    for (i = 0; i < fontFiles.length; i++) {
    Module[(self.lazyFontLoading && fontFiles[i].indexOf('blob:') !== 0) ? 'FS_createLazyFile' : 'FS_createPreloadedFile']('/fonts', 'font' + i + '-' + fontFiles[i].split('/').pop(), fontFiles[i], true, false)
    }
})

Module.onRuntimeInitialized = function () {
  self.octObj = new Module.SubtitleOctopus()

  self.changed = Module._malloc(4)

  if (self.debug) {
    self.octObj.setLogLevel(7)
    }
  self.octObj.initLibrary(screen.width, screen.height, self.fallbackFont ? '/fonts/.fallback-' + self.fallbackFont.split('/').pop() : '/default.woff2')
    self.octObj.setDropAnimations(!!self.dropAllAnimations)
    self.octObj.createTrack('/sub.ass')
    self.ass_track = self.octObj.track
    self.ass_library = self.octObj.ass_library
    self.ass_renderer = self.octObj.ass_renderer

    if (self.libassMemoryLimit > 0 || self.libassGlyphLimit > 0) {
    self.octObj.setMemoryLimits(self.libassGlyphLimit, self.libassMemoryLimit)
    }
}

Module.print = function (text) {
  if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' ')
    console.log(text)
};
Module.printErr = function (text) {
  if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' ')
    console.error(text)
};

// Modified from https://github.com/kripken/emscripten/blob/6dc4ac5f9e4d8484e273e4dcc554f809738cedd6/src/proxyWorker.js
if (!hasNativeConsole) {
  // we can't call Module.printErr because that might be circular
  var console = {
    log: function (x) {
      if (typeof dump === 'function') dump('log: ' + x + '\n')
        },
    debug: function (x) {
      if (typeof dump === 'function') dump('debug: ' + x + '\n')
        },
    info: function (x) {
      if (typeof dump === 'function') dump('info: ' + x + '\n')
        },
    warn: function (x) {
      if (typeof dump === 'function') dump('warn: ' + x + '\n')
        },
    error: function (x) {
      if (typeof dump === 'function') dump('error: ' + x + '\n')
        }
  }
}

Module.print = function (text) {
  if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' ')
  console.log(text)
}
Module.printErr = function (text) {
  if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' ')
  console.error(text)
}
