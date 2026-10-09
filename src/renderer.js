import {
  INK_BLEED, EMERALD_TABLET, VERTEX_SHADER, INK_FRAGMENT, EMERALD_FRAGMENT,
} from './shaders.js'
import marbleUrl from './assets/emerald-marble.png'

export function loadMarbleImage() {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Unable to load the Emerald Tablet marble texture'))
    image.src = marbleUrl
  })
}

export function createRenderer(canvas, marbleImage) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' })
  if (!gl) throw new Error('WebGL is unavailable')
  gl.getExtension('OES_standard_derivatives')

  const resources = []
  const track = (resource, remove) => {
    if (!resource) throw new Error('Unable to allocate a WebGL resource')
    resources.push(() => remove.call(gl, resource))
    return resource
  }
  const dispose = () => resources.splice(0).reverse().forEach((remove) => remove())

  const makeProgram = (fragment) => {
    const program = track(gl.createProgram(), gl.deleteProgram)
    for (const [type, code] of [[gl.VERTEX_SHADER, VERTEX_SHADER], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = track(gl.createShader(type), gl.deleteShader)
      gl.shaderSource(shader, code)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader))
      gl.attachShader(program, shader)
    }
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program))
    return program
  }

  const makeTexture = () => {
    const texture = track(gl.createTexture(), gl.deleteTexture)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return texture
  }

  try {
    const inkProgram = makeProgram(INK_FRAGMENT)
    const emeraldProgram = makeProgram(EMERALD_FRAGMENT)
    const inputTexture = makeTexture()
    const inkTexture = makeTexture()
    const marbleTexture = makeTexture()
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, marbleImage)
    const framebuffer = track(gl.createFramebuffer(), gl.deleteFramebuffer)
    const quad = track(gl.createBuffer(), gl.deleteBuffer)
    gl.bindBuffer(gl.ARRAY_BUFFER, quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)

    const textCanvas = document.createElement('canvas')
    const textContext = textCanvas.getContext('2d')
    if (!textContext) throw new Error('Canvas text rendering is unavailable')
    let allocatedWidth = 0
    let allocatedHeight = 0

    const programs = [
      { program: inkProgram, settings: INK_BLEED },
      { program: emeraldProgram, settings: EMERALD_TABLET },
    ].map(({ program, settings }) => ({
      program,
      position: gl.getAttribLocation(program, 'position'),
      source: gl.getUniformLocation(program, 'source'),
      marble: gl.getUniformLocation(program, 'marbleLUT'),
      size: gl.getUniformLocation(program, 'size'),
      settings: Object.entries(settings).map(([key, value]) => ({ location: gl.getUniformLocation(program, key), value })),
    }))

    const drawPass = (pass, source, target, width, height) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target)
      gl.viewport(0, 0, width, height)
      gl.useProgram(pass.program)
      gl.bindBuffer(gl.ARRAY_BUFFER, quad)
      gl.enableVertexAttribArray(pass.position)
      gl.vertexAttribPointer(pass.position, 2, gl.FLOAT, false, 0, 0)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, source)
      gl.uniform1i(pass.source, 0)
      if (pass.marble !== null) {
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, marbleTexture)
        gl.uniform1i(pass.marble, 1)
        gl.activeTexture(gl.TEXTURE0)
      }
      gl.uniform2f(pass.size, width, height)
      pass.settings.forEach(({ location, value }) => {
        if (Array.isArray(value)) gl.uniform3fv(location, value)
        else gl.uniform1f(location, value)
      })
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }

    const render = (content) => {
      const bounds = canvas.getBoundingClientRect()
      if (!bounds.width || !bounds.height || gl.isContextLost()) return false
      // Render at native density, with a bounded texture size on large displays.
      const limit = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 4096)
      const density = Math.min(window.devicePixelRatio || 1, 2, limit / bounds.width, limit / bounds.height)
      const width = Math.max(1, Math.round(bounds.width * density))
      const height = Math.max(1, Math.round(bounds.height * density))
      if (allocatedWidth !== width || allocatedHeight !== height) {
        canvas.width = textCanvas.width = width
        canvas.height = textCanvas.height = height
        gl.bindTexture(gl.TEXTURE_2D, inkTexture)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, inkTexture, 0)
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error('Ink Bleed framebuffer is incomplete')
        }
        allocatedWidth = width
        allocatedHeight = height
      }

      textContext.setTransform(density, 0, 0, density, 0, 0)
      textContext.fillStyle = '#fff'
      textContext.fillRect(0, 0, bounds.width, bounds.height)
      textContext.fillStyle = '#000'
      textContext.textBaseline = 'alphabetic'

      // Mirror all text pieces, including the subtitle, link labels, and bullets.
      content.querySelectorAll('[data-text-piece]').forEach((piece) => {
        const box = piece.getBoundingClientRect()
        const style = getComputedStyle(piece)
        textContext.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
        const text = piece.textContent
        const metrics = textContext.measureText(text)
        const ascent = metrics.fontBoundingBoxAscent ?? metrics.actualBoundingBoxAscent
        const descent = metrics.fontBoundingBoxDescent ?? metrics.actualBoundingBoxDescent
        const baseline = box.top - bounds.top + (box.height + ascent - descent) / 2
        textContext.fillText(text, box.left - bounds.left, baseline)
      })

      gl.bindTexture(gl.TEXTURE_2D, inputTexture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas)
      drawPass(programs[0], inputTexture, framebuffer, width, height)
      drawPass(programs[1], inkTexture, null, width, height)
      const error = gl.getError()
      if (error !== gl.NO_ERROR) throw new Error(`WebGL error ${error}`)
      return true
    }

    return { render, dispose }
  } catch (error) {
    dispose()
    throw error
  }
}
