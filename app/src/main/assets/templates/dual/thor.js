// Tiny helper around the native bridge Thor IDE injects into every page.
// Works on both screens; in a normal browser it degrades to a no-op.
window.Thor = {
  screen: () => (window.ThorNative ? ThorNative.screen() : 'top'),
  isDual: () => (window.ThorNative ? ThorNative.isDual() : false),
  // Send any JSON-able object to the OTHER screen.
  send: (obj) => { if (window.ThorNative) ThorNative.send(JSON.stringify(obj)); },
  // Register a handler for messages from the other screen.
  on: (fn) => { window.onThorMessage = fn; },
};
