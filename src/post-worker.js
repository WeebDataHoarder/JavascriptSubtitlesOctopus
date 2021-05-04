Module.FS = FS

self.delay = 0 // approximate delay (time of render + postMessage + drawImage), for example 1/60 or 0
self.lastCurrentTime = 0
self.rate = 1
self.rafId = null
self.nextIsRaf = false
self.lastCurrentTimeReceivedAt = Date.now()
self.targetFps = 30
self.libassMemoryLimit = 0 // in MiB
self.renderOnDemand = false // determines if only rendering on demand
self.dropAllAnimations = false // set to true to enable "lite mode" with all animations disabled for speed

self.width = 0
self.height = 0

self.fontMap_ = {}
self.fontId = 0

/**
 * Required as only Chromium decodes data URI from XHR
 * @param dataURI
 * @returns {Uint8Array}
 */
self.readDataUri = function (dataURI) {
  if (typeof dataURI !== 'string') {
    throw new Error('Invalid argument: dataURI must be a string')
  }
  dataURI = dataURI.split(',')
  const byteString = atob(dataURI[1])
  const byteStringLength = byteString.length
  const arrayBuffer = new ArrayBuffer(byteStringLength)
  const intArray = new Uint8Array(arrayBuffer)
  for (let i = 0; i < byteStringLength; i++) {
    intArray[i] = byteString.charCodeAt(i)
  }
  return intArray
}

self.decodeASSFontEncoding = function (input) {
  const output = new Uint8Array(input.length)
  const grouping = new Uint8Array(4)

  let offset = 0
  let arrayOffset = 0
  let writeOffset = 0
  let charCode
  while (offset < input.length) {
    charCode = input.charCodeAt(offset++)
    if (charCode >= 0x21 && charCode <= 0x60) {
      grouping[arrayOffset++] = charCode - 33
      if (arrayOffset === 4) {
        output[writeOffset++] = (grouping[0] << 2) | (grouping[1] >> 4)
        output[writeOffset++] = ((grouping[1] & 0xf) << 4) | (grouping[2] >> 2)
        output[writeOffset++] = ((grouping[2] & 0x3) << 6) | (grouping[3])
        arrayOffset = 0
      }
    }
  }

  // Handle ASS special padding
  if (arrayOffset > 0) {
    if (arrayOffset === 2) {
      output[writeOffset++] = ((grouping[0] << 6) | grouping[1]) >> 4
    } else if (arrayOffset === 3) {
      const ix = ((grouping[0] << 12) | (grouping[1] << 6) | grouping[2]) >> 2
      output[writeOffset++] = ix >> 8
      output[writeOffset++] = ix & 0xff
    }
  }

  return output.slice(0, writeOffset)
}

/**
 * Make the font accessible by libass by writing it to the virtual FS.
 * @param {!string} font the font name.
 */
self.writeFontToFS = function (font) {
  font = font.trim().toLowerCase()

  if (font.startsWith('@')) {
    font = font.substr(1)
  }

  if (self.fontMap_.hasOwnProperty(font)) return

  self.fontMap_[font] = true

  let path
  if (self.availableFonts.hasOwnProperty(font)) {
    path = self.availableFonts[font]
  } else {
    return
  }

  Module[(self.lazyFontLoading && path.indexOf('blob:') !== 0) ? 'FS_createLazyFile' : 'FS_createPreloadedFile']('/fonts', 'font' + (self.fontId++) + '-' + path.split('/').pop(), path, true, false)
}

/**
 * Write all font's mentioned in the .ass file to the virtual FS.
 * @param {!string} content the file content.
 */
self.writeAvailableFontsToFS = function (content) {
  if (!self.availableFonts) return

  const sections = parseAss(content)

  for (let i = 0; i < sections.length; i++) {
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

self.getRenderMethod = function () {
  if (self.renderMode === 'fast') {
    return self.fastRender
  } else if (self.renderMode === 'blend') {
    return self.blendRender
  } else {
    return self.render
  }
}

/**
 * Set the subtitle track.
 * @param {!string} content the content of the subtitle file.
 */
self.setTrack = function (content) {
  // Make sure that the fonts are loaded
  self.writeAvailableFontsToFS(content)

  // Write the subtitle file to the virtual FS.
  Module.FS.writeFile('/sub.ass', content)

  // Tell libass to render the new track
  self.octObj.createTrack('/sub.ass')
  self.ass_track = self.octObj.track
  if (!self.renderOnDemand) {
    self.getRenderMethod()()
  }
}

/**
 * Remove subtitle track.
 */
self.freeTrack = function () {
  self.octObj.removeTrack()
  if (!self.renderOnDemand) {
    self.getRenderMethod()()
  }
}

/**
 * Set the subtitle track.
 * @param {!string} url the URL of the subtitle file.
 */
self.setTrackByUrl = function (url) {
  const content = read_(url)
  self.setTrack(content)
}

self.resize = function (width, height) {
  self.width = width
  self.height = height
  self.octObj.resizeCanvas(width, height)
}

self.getCurrentTime = function () {
  const diff = (Date.now() - self.lastCurrentTimeReceivedAt) / 1000
  if (self._isPaused) {
    return self.lastCurrentTime
  } else {
    if (diff > 5) {
      console.error('Didn\'t received currentTime > 5 seconds. Assuming video was paused.')
      self.setIsPaused(true)
    }
    return self.lastCurrentTime + (diff * self.rate)
  }
}
self.setCurrentTime = function (currentTime) {
  self.lastCurrentTime = currentTime
  self.lastCurrentTimeReceivedAt = Date.now()
  if (!self.rafId) {
    if (self.nextIsRaf) {
      if (!self.renderOnDemand) {
        self.rafId = self.requestAnimationFrame(self.getRenderMethod())
      }
    } else {
      if (!self.renderOnDemand) {
        self.getRenderMethod()()
      }

      // Give onmessage chance to receive all queued messages
      setTimeout(function () {
        self.nextIsRaf = false
      }, 20)
    }
  }
}

self._isPaused = true
self.getIsPaused = function () {
  return self._isPaused
}
self.setIsPaused = function (isPaused) {
  if (isPaused != self._isPaused) {
    self._isPaused = isPaused
    if (isPaused) {
      if (self.rafId) {
        clearTimeout(self.rafId)
        self.rafId = null
      }
    } else {
      self.lastCurrentTimeReceivedAt = Date.now()
      if (!self.renderOnDemand) {
        self.rafId = self.requestAnimationFrame(self.getRenderMethod())
      }
    }
  }
}

self.render = function (force) {
  self.rafId = 0
  self.renderPending = false
  const startTime = performance.now()
  const renderResult = self.octObj.renderImage(self.getCurrentTime() + self.delay, self.changed)
  const changed = Module.getValue(self.changed, 'i32')
  if (changed !== 0 || force) {
    const result = self.buildResult(renderResult)
    const spentTime = performance.now() - startTime
    postMessage({
      target: 'canvas',
      op: 'renderCanvas',
      time: Date.now(),
      spentTime: spentTime,
      canvases: result[0]
    }, result[1])
  }

  if (!self._isPaused) {
    self.rafId = self.requestAnimationFrame(self.render)
  }
}

self.blendRenderTiming = function (timing, force) {
  const startTime = performance.now()

  const renderResult = self.octObj.renderBlend(timing, force)
  const blendTime = renderResult.blend_time
  const canvases = []; const buffers = []
  if (renderResult.ptr !== 0 && (renderResult.changed !== 0 || force)) {
    // make a copy, as we should free the memory so subsequent calls can utilize it
    for (let part = renderResult.part; part.ptr !== 0; part = part.next) {
      const result = new Uint8Array(HEAPU8.subarray(part.image, part.image + part.dest_width * part.dest_height * 4))
      canvases.push({ w: part.dest_width, h: part.dest_height, x: part.dest_x, y: part.dest_y, buffer: result.buffer })
      buffers.push(result.buffer)
    }
  }

  return {
    time: Date.now(),
    spentTime: performance.now() - startTime,
    blendTime: blendTime,
    canvases: canvases,
    buffers: buffers
  }
}

self.blendRender = function (force) {
  self.rafId = 0
  self.renderPending = false

  const rendered = self.blendRenderTiming(self.getCurrentTime() + self.delay, force)
  if (rendered.canvases.length > 0) {
    postMessage({
      target: 'canvas',
      op: 'renderCanvas',
      time: rendered.time,
      spentTime: rendered.spentTime,
      blendTime: rendered.blendTime,
      canvases: rendered.canvases
    }, rendered.buffers)
  }

  if (!self._isPaused) {
    self.rafId = self.requestAnimationFrame(self.blendRender)
  }
}

self.oneshotRender = function (lastRenderedTime, renderNow, iteration) {
  const eventStart = renderNow ? lastRenderedTime : self.octObj.findNextEventStart(lastRenderedTime)
  let eventFinish = -1.0; let emptyFinish = -1.0; let animated = false
  let rendered = {}
  if (eventStart >= 0) {
    eventTimes = self.octObj.findEventStopTimes(eventStart)
    eventFinish = eventTimes.eventFinish
    emptyFinish = eventTimes.emptyFinish
    animated = eventTimes.is_animated

    rendered = self.blendRenderTiming(eventStart, true)
  }

  postMessage({
    target: 'canvas',
    op: 'oneshot-result',
    iteration: iteration,
    lastRenderedTime: lastRenderedTime,
    eventStart: eventStart,
    eventFinish: eventFinish,
    emptyFinish: emptyFinish,
    animated: animated,
    viewport: {
      width: self.width,
      height: self.height
    },
    spentTime: rendered.spentTime || 0,
    blendTime: rendered.blendTime || 0,
    canvases: rendered.canvases || []
  }, rendered.buffers || [])
}

self.fastRender = function (force) {
  self.rafId = 0
  self.renderPending = false
  const startTime = performance.now()
  const renderResult = self.octObj.renderImage(self.getCurrentTime() + self.delay, self.changed)
  const changed = Module.getValue(self.changed, 'i32')
  if (changed !== 0 || force) {
    const result = self.buildResult(renderResult)
    const newTime = performance.now()
    const libassTime = newTime - startTime
    const promises = []
    for (let i = 0; i < result[0].length; i++) {
      const image = result[0][i]
      const imageBuffer = new Uint8ClampedArray(image.buffer)
      const imageData = new ImageData(imageBuffer, image.w, image.h)
      promises[i] = createImageBitmap(imageData, 0, 0, image.w, image.h)
    }
    Promise.all(promises).then(function (imgs) {
      const decodeTime = performance.now() - newTime
      const bitmaps = []
      for (let i = 0; i < imgs.length; i++) {
        const image = result[0][i]
        bitmaps[i] = { x: image.x, y: image.y, bitmap: imgs[i] }
      }
      postMessage({
        target: 'canvas',
        op: 'renderFastCanvas',
        time: Date.now(),
        libassTime: libassTime,
        decodeTime: decodeTime,
        bitmaps: bitmaps
      }, imgs)
    })
  }
  if (!self._isPaused) {
    self.rafId = self.requestAnimationFrame(self.fastRender)
  }
}

self.buildResult = function (ptr) {
  const items = []
  const transferable = []
  let item

  while (ptr.ptr !== 0) {
    item = self.buildResultItem(ptr)
    if (item !== null) {
      items.push(item)
      transferable.push(item.buffer)
    }
    ptr = ptr.next
  }

  return [items, transferable]
}

self.buildResultItem = function (ptr) {
  const bitmap = ptr.bitmap
  const stride = ptr.stride
  const w = ptr.w
  const h = ptr.h
  const color = ptr.color

  if (w == 0 || h == 0) {
    return null
  }

  const r = (color >> 24) & 0xFF
  const g = (color >> 16) & 0xFF
  const b = (color >> 8) & 0xFF
  const a = 255 - (color & 0xFF)

  const result = new Uint8ClampedArray(4 * w * h)

  let bitmapPosition = 0
  let resultPosition = 0

  for (var y = 0; y < h; ++y) {
    for (var x = 0; x < w; ++x) {
      const k = Module.HEAPU8[bitmap + bitmapPosition + x] * a / 255
      result[resultPosition] = r
      result[resultPosition + 1] = g
      result[resultPosition + 2] = b
      result[resultPosition + 3] = k
      resultPosition += 4
    }
    bitmapPosition += stride
  }

  x = ptr.dst_x
  y = ptr.dst_y

  return { w: w, h: h, x: x, y: y, buffer: result.buffer }
}

if (typeof SDL !== 'undefined') {
  SDL.defaults.copyOnLock = false
  SDL.defaults.discardOnLock = false
  SDL.defaults.opaqueFrontBuffer = false
}

function FPSTracker (text) {
  let last = 0
  let mean = 0
  let counter = 0
  this.tick = function () {
    const now = Date.now()
    if (last > 0) {
      const diff = now - last
      mean = 0.99 * mean + 0.01 * diff
      if (counter++ === 60) {
        counter = 0
        dump(text + ' fps: ' + (1000 / mean).toFixed(2) + '\n')
      }
    }
    last = now
  }
}

/**
 * Parse the content of an .ass file.
 * @param {!string} content the content of the file
 */
function parseAss (content) {
  let m, format, lastPart, parts, key, value, tmp, i, j, body
  const sections = []
  const lines = content.split(/[\r\n]+/g)
  for (i = 0; i < lines.length; i++) {
    m = lines[i].match(/^\[(.*)\]$/)
    if (m) {
      format = null
      sections.push({
        name: m[1],
        body: []
      })
    } else {
      if (/^\s*$/.test(lines[i])) continue
      if (sections.length === 0) continue
      body = sections[sections.length - 1].body
      if (lines[i][0] === ';') {
        body.push({
          type: 'comment',
          value: lines[i].substring(1)
        })
      } else {
        parts = lines[i].split(':')
        key = parts[0]
        value = parts.slice(1).join(':').trim()
        if (format || key === 'Format') {
          value = value.split(',')
          if (format && value.length > format.length) {
            lastPart = value.slice(format.length - 1).join(',')
            value = value.slice(0, format.length - 1)
            value.push(lastPart)
          }
          value = value.map(function (s) {
            return s.trim()
          })
          if (format) {
            tmp = {}
            for (j = 0; j < value.length; j++) {
              tmp[format[j]] = value[j]
            }
            value = tmp
          }
        }
        if (key === 'Format') {
          format = value
        }
        body.push({
          key: key,
          value: value
        })
      }
    }
  }

  return sections
};

self.requestAnimationFrame = (function () {
  // similar to Browser.requestAnimationFrame
  let nextRAF = 0
  return function (func) {
    // try to keep target fps (30fps) between calls to here
    const now = Date.now()
    if (nextRAF === 0) {
      nextRAF = now + 1000 / self.targetFps
    } else {
      while (now + 2 >= nextRAF) { // fudge a little, to avoid timer jitter causing us to do lots of delay:0
        nextRAF += 1000 / self.targetFps
      }
    }
    const delay = Math.max(nextRAF - now, 0)
    return setTimeout(func, delay)
    // return setTimeout(func, 1);
  }
})()

const screen = {
  width: 0,
  height: 0
}

Module.print = function Module_print (x) {
  // dump('OUT: ' + x + '\n');
  postMessage({ target: 'stdout', content: x })
}
Module.printErr = function Module_printErr (x) {
  // dump('ERR: ' + x + '\n');
  postMessage({ target: 'stderr', content: x })
}

// Frame throttling

let frameId = 0
let clientFrameId = 0
let commandBuffer = []

const postMainLoop = Module.postMainLoop
Module.postMainLoop = function () {
  if (postMainLoop) postMainLoop()
  // frame complete, send a frame id
  postMessage({ target: 'tick', id: frameId++ })
  commandBuffer = []
}

// Wait to start running until we receive some info from the client
// addRunDependency('gl-prefetch');
addRunDependency('worker-init')

// buffer messages until the program starts to run

let messageBuffer = null
let messageResenderTimeout = null

function messageResender () {
  if (calledMain) {
    assert(messageBuffer && messageBuffer.length > 0)
    messageResenderTimeout = null
    messageBuffer.forEach(function (message) {
      onmessage(message)
    })
    messageBuffer = null
  } else {
    messageResenderTimeout = setTimeout(messageResender, 50)
  }
}

function _applyKeys (input, output) {
  const vargs = Object.keys(input)

  for (let i = 0; i < vargs.length; i++) {
    output[vargs[i]] = input[vargs[i]]
  }
}

function onMessageFromMainEmscriptenThread (message) {
  if (!calledMain && !message.data.preMain) {
    if (!messageBuffer) {
      messageBuffer = []
      messageResenderTimeout = setTimeout(messageResender, 50)
    }
    messageBuffer.push(message)
    return
  }
  if (calledMain && messageResenderTimeout) {
    clearTimeout(messageResenderTimeout)
    messageResender()
  }
  // console.log('worker got ' + JSON.stringify(message.data).substr(0, 150) + '\n');
  switch (message.data.target) {
    case 'window': {
      self.fireEvent(message.data.event)
      break
    }
    case 'canvas': {
      if (message.data.event) {
        Module.canvas.fireEvent(message.data.event)
      } else if (message.data.width) {
        if (Module.canvas && message.data.boundingClientRect) {
          Module.canvas.boundingClientRect = message.data.boundingClientRect
        }
        self.resize(message.data.width, message.data.height)
        if (!self.renderOnDemand) {
          self.getRenderMethod()()
        }
      } else throw 'ey?'
      break
    }
    case 'video': {
      if (message.data.currentTime !== undefined) {
        self.setCurrentTime(message.data.currentTime)
      }
      if (message.data.isPaused !== undefined) {
        self.setIsPaused(message.data.isPaused)
      }
      if (message.data.rate) {
        self.rate = message.data.rate
      }
      break
    }
    case 'tock': {
      clientFrameId = message.data.id
      break
    }
    case 'worker-init': {
      // Module.canvas = document.createElement('canvas');
      screen.width = self.width = message.data.width
      screen.height = self.height = message.data.height
      self.subUrl = message.data.subUrl
      self.subContent = message.data.subContent
      self.fontFiles = message.data.fonts
      self.renderMode = message.data.renderMode
      if (self.renderMode === 'fast' && typeof createImageBitmap === 'undefined') {
        self.renderMode = 'normal'
      }
      self.availableFonts = message.data.availableFonts
      self.fallbackFont = message.data.fallbackFont
      self.debug = message.data.debug
      if (Module.canvas) {
        Module.canvas.width_ = message.data.width
        Module.canvas.height_ = message.data.height
        if (message.data.boundingClientRect) {
          Module.canvas.boundingClientRect = message.data.boundingClientRect
        }
      }
      self.targetFps = message.data.targetFps || self.targetFps
      self.libassMemoryLimit = message.data.libassMemoryLimit || self.libassMemoryLimit
      self.libassGlyphLimit = message.data.libassGlyphLimit || 0
      self.renderOnDemand = message.data.renderOnDemand || false
      self.dropAllAnimations = message.data.dropAllAnimations || false
      removeRunDependency('worker-init')
      postMessage({
        target: 'ready'
      })
      break
    }
    case 'oneshot-render':
      self.oneshotRender(message.data.lastRendered,
        message.data.renderNow || false,
        message.data.iteration)
      break
    case 'destroy':
      self.octObj.quitLibrary()
      break
    case 'free-track':
      self.freeTrack()
      break
    case 'set-track':
      self.setTrack(message.data.content)
      break
    case 'set-track-by-url':
      self.setTrackByUrl(message.data.url)
      break
    case 'create-event':
      var event = message.data.event
      var i = self.octObj.allocEvent()
      var evnt_ptr = self.octObj.track.get_events(i)
      _applyKeys(event, evnt_ptr)
      break
    case 'get-events':
      var events = []
      for (var i = 0; i < self.octObj.getEventCount(); i++) {
        var evnt_ptr = self.octObj.track.get_events(i)
        var event = {
          Start: evnt_ptr.get_Start(),
          Duration: evnt_ptr.get_Duration(),
          ReadOrder: evnt_ptr.get_ReadOrder(),
          Layer: evnt_ptr.get_Layer(),
          Style: evnt_ptr.get_Style(),
          Name: evnt_ptr.get_Name(),
          MarginL: evnt_ptr.get_MarginL(),
          MarginR: evnt_ptr.get_MarginR(),
          MarginV: evnt_ptr.get_MarginV(),
          Effect: evnt_ptr.get_Effect(),
          Text: evnt_ptr.get_Text()
        }

        events.push(event)
      }
      postMessage({
        target: 'get-events',
        time: Date.now(),
        events: events
      })
      break
    case 'set-event':
      var event = message.data.event
      var i = message.data.index
      var evnt_ptr = self.octObj.track.get_events(i)
      _applyKeys(event, evnt_ptr)
      break
    case 'remove-event':
      var i = message.data.index
      self.octObj.removeEvent(i)
      break
    case 'create-style':
      var style = message.data.style
      var i = self.octObj.allocStyle()
      var styl_ptr = self.octObj.track.get_styles(i)
      _applyKeys(style, styl_ptr)
      break
    case 'get-styles':
      var styles = []
      for (var i = 0; i < self.octObj.getStyleCount(); i++) {
        var styl_ptr = self.octObj.track.get_styles(i)
        var style = {
          Name: styl_ptr.get_Name(),
          FontName: styl_ptr.get_FontName(),
          FontSize: styl_ptr.get_FontSize(),
          PrimaryColour: styl_ptr.get_PrimaryColour(),
          SecondaryColour: styl_ptr.get_SecondaryColour(),
          OutlineColour: styl_ptr.get_OutlineColour(),
          BackColour: styl_ptr.get_BackColour(),
          Bold: styl_ptr.get_Bold(),
          Italic: styl_ptr.get_Italic(),
          Underline: styl_ptr.get_Underline(),
          StrikeOut: styl_ptr.get_StrikeOut(),
          ScaleX: styl_ptr.get_ScaleX(),
          ScaleY: styl_ptr.get_ScaleY(),
          Spacing: styl_ptr.get_Spacing(),
          Angle: styl_ptr.get_Angle(),
          BorderStyle: styl_ptr.get_BorderStyle(),
          Outline: styl_ptr.get_Outline(),
          Shadow: styl_ptr.get_Shadow(),
          Alignment: styl_ptr.get_Alignment(),
          MarginL: styl_ptr.get_MarginL(),
          MarginR: styl_ptr.get_MarginR(),
          MarginV: styl_ptr.get_MarginV(),
          Encoding: styl_ptr.get_Encoding(),
          treat_fontname_as_pattern: styl_ptr.get_treat_fontname_as_pattern(),
          Blur: styl_ptr.get_Blur(),
          Justify: styl_ptr.get_Justify()
        }
        styles.push(style)
      }
      postMessage({
        target: 'get-styles',
        time: Date.now(),
        styles: styles
      })
      break
    case 'set-style':
      var style = message.data.style
      var i = message.data.index
      var styl_ptr = self.octObj.track.get_styles(i)
      _applyKeys(style, styl_ptr)
      break
    case 'remove-style':
      var i = message.data.index
      self.octObj.removeStyle(i)
      break
    case 'runBenchmark': {
      self.runBenchmark()
      break
    }
    case 'custom': {
      if (Module.onCustomMessage) {
        Module.onCustomMessage(message)
      } else {
        throw 'Custom message received but worker Module.onCustomMessage not implemented.'
      }
      break
    }
    case 'setimmediate': {
      if (Module.setImmediates) Module.setImmediates.shift()()
      break
    }
    default:
      throw 'wha? ' + message.data.target
  }
};

onmessage = onMessageFromMainEmscriptenThread

function postCustomMessage (data) {
  postMessage({ target: 'custom', userData: data })
}

self.runBenchmark = function (seconds, pos, async) {
  let totalTime = 0
  let i = 0
  pos = pos || 0
  seconds = seconds || 60
  const count = seconds * self.targetFps
  const start = performance.now()
  let longestFrame = 0
  var run = function () {
    const t0 = performance.now()

    pos += 1 / self.targetFps
    self.setCurrentTime(pos)

    const t1 = performance.now()
    const diff = t1 - t0
    totalTime += diff
    if (diff > longestFrame) {
      longestFrame = diff
    }

    if (i < count) {
      i++

      if (async) {
        self.requestAnimationFrame(run)
        return false
      } else {
        return true
      }
    } else {
      console.log('Performance fps: ' + Math.round(1000 / (totalTime / count)) + '')
      console.log('Real fps: ' + Math.round(1000 / ((t1 - start) / count)) + '')
      console.log('Total time: ' + totalTime)
      console.log('Longest frame: ' + Math.ceil(longestFrame) + 'ms (' + Math.floor(1000 / longestFrame) + ' fps)')

      return false
    }
  }

  while (true) {
    if (!run()) {
      break
    }
  }
}
