const embeddedPlayerPaths = [
  '/html/player.html',
  '/blackboard/html5player.html',
  '/blackboard/newplayer.html',
]

/** Decide at document-start without loading the core or waiting for frame contents. */
export const checkIframes = () => {
  if (window.top === window.self) {
    return true
  }
  // A screenshot document may inherit a player URL after document.open/write.
  // It never needs another enhancement runtime, even on the player allowlist.
  if (window.frameElement?.matches('iframe.html2canvas-container[data-html2canvas-ignore]')) {
    return false
  }
  if (location.hostname === 'player.bilibili.com') {
    return true
  }
  if (location.hostname !== 'www.bilibili.com') {
    return false
  }
  // The parent owns this native player, including its controls and lifetime.
  if (
    /^\/video\//.test(location.pathname) &&
    new URLSearchParams(location.search).get('bilibili_clear_shorts') === '1'
  ) {
    return false
  }
  // Only dedicated embedded players need their own enhancement runtime. Navigation,
  // login, messaging and other helper frames keep their native behavior without it.
  return embeddedPlayerPaths.includes(location.pathname)
}
