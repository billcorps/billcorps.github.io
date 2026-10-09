import { useEffect, useRef, useState } from 'react'
import '@fontsource-variable/source-serif-4'
import '@fontsource/noto-sans-symbols-2'
import { createRenderer, loadMarbleImage } from './renderer.js'
import { SITES } from './sites.js'

export const MESSAGE = '🜗 Hello, This is BillCorps'
export const SUBTITLE = '🜁, 🜃, 🜄, 🜂, and 🜉'
const subtitleWords = SUBTITLE.split(' ')

export default function ShaderText() {
  const canvasRef = useRef(null)
  const introRef = useRef(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const intro = introRef.current
    let renderer
    let marbleImage
    let disposed = false
    let frame = 0

    const paint = () => {
      if (disposed || !renderer) return
      try {
        setReady(renderer.render(intro))
      } catch (error) {
        console.error('BillCorps shader rendering failed:', error)
        setReady(false)
      }
    }

    const schedulePaint = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(paint)
    }

    const onContextLost = (event) => {
      event.preventDefault()
      setReady(false)
      cancelAnimationFrame(frame)
    }

    const onContextRestored = () => {
      renderer?.dispose()
      if (!marbleImage) return
      try {
        renderer = createRenderer(canvas, marbleImage)
        schedulePaint()
      } catch (error) {
        console.error('BillCorps shader restoration failed:', error)
        setReady(false)
      }
    }

    const observer = new ResizeObserver(schedulePaint)
    observer.observe(canvas)
    observer.observe(intro)
    window.addEventListener('resize', schedulePaint)
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', onContextRestored)

    // Wait for the local fonts and marble lookup before creating the GPU passes.
    Promise.all([
      document.fonts.load('400 64px "Source Serif 4 Variable"'),
      document.fonts.load('400 64px "Noto Sans Symbols 2"', '🜗'),
      document.fonts.ready,
      loadMarbleImage(),
    ]).then(([, , , image]) => {
      if (disposed) return
      marbleImage = image
      try {
        renderer = createRenderer(canvas, marbleImage)
        paint()
      } catch (error) {
        // The semantic heading stays visible when WebGL is unavailable.
        console.error('BillCorps shaders are unavailable:', error)
      }
    }).catch((error) => console.error('BillCorps asset loading failed:', error))

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('resize', schedulePaint)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', onContextRestored)
      renderer?.dispose()
    }
  }, [])

  return (
    <main className={`billcorps${ready ? ' is-rendered' : ''}`} data-shaders={ready ? 'ready' : 'fallback'}>
      <div ref={introRef} className="intro">
        <h1 aria-label={MESSAGE}>
          <span className="salutation">
            <span className="alchemical-symbol" data-text-piece>🜗</span>
            <span data-text-piece>{' Hello,'}</span>
          </span>{' '}
          <span data-text-piece>This is BillCorps</span>
        </h1>
        <p className="subtitle">
          {subtitleWords.map((word, index) => (
            <span key={index} data-text-piece>{word}{index < subtitleWords.length - 1 ? ' ' : ''}</span>
          ))}
        </p>
        <nav aria-label="Other BillCorps sites">
          <ul className="site-links" role="list">
            {SITES.map((site) => (
              <li key={site.url}>
                <span className="site-bullet alchemical-symbol" aria-hidden="true" data-text-piece>🜗</span>
                <a className="site-link" href={site.url}>
                  <span data-text-piece>{site.name}</span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <canvas ref={canvasRef} className="shader-canvas" aria-hidden="true" />
    </main>
  )
}
