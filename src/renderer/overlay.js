/* global window, document */

const bg = document.getElementById('bg')
const sel = document.getElementById('selection')

let startX = 0
let startY = 0
let dragging = false

window.overlay.ready()
window.overlay.onScreenshotReady(() => {
  window.overlay.getScreenshot().then((dataUrl) => {
    if (dataUrl) {
      bg.style.backgroundImage = `url('${dataUrl}')`
    }
  })
})

document.addEventListener('pointerdown', (e) => {
  startX = e.clientX
  startY = e.clientY
  dragging = true
  sel.style.display = 'block'
  updateSelection(e.clientX, e.clientY)
})

document.addEventListener('pointermove', (e) => {
  if (!dragging) return
  updateSelection(e.clientX, e.clientY)
})

document.addEventListener('pointerup', (e) => {
  if (!dragging) return
  dragging = false

  const x = Math.min(startX, e.clientX)
  const y = Math.min(startY, e.clientY)
  const width = Math.abs(e.clientX - startX)
  const height = Math.abs(e.clientY - startY)

  if (width >= 10 && height >= 10) {
    window.overlay.submit({ x, y, width, height })
  } else {
    sel.style.display = 'none'
    dragging = false
  }
})

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    window.overlay.cancel()
  }
})

function updateSelection(currentX, currentY) {
  const x = Math.min(startX, currentX)
  const y = Math.min(startY, currentY)
  const width = Math.abs(currentX - startX)
  const height = Math.abs(currentY - startY)
  sel.style.left = x + 'px'
  sel.style.top = y + 'px'
  sel.style.width = width + 'px'
  sel.style.height = height + 'px'
}
