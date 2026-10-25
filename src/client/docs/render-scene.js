/** Resize a document embed's rendered canvas without losing its host mode. */
export function documentCanvasScene(scene, width, height) {
  return {
    title: scene.title,
    mode: scene.mode,
    width,
    height,
    notices: scene.notices,
    items: scene.items.map(item => ({ ...item, geometry: { x: 0, y: 0, width, height } })),
  }
}
