// Composes the social preview: hides the UI, frames the galaxy to fill a wide
// crop, and lays the wordmark over it. Run via tools/screenshot.mjs --eval-file.
document.getElementById('ui-root').style.display = 'none';

// Card names are drawn into the canvas, not the UI overlay, so they survive
// hiding the chrome — and a social card wants the galaxy, not a list of
// Commander staples.
window.__mcu.store.patchVisual({ showLabels: false });

const rig = window.__mcu.app.rig;
rig.setAngles(0.55, 1.06);
rig.frame(470); // closer than the default fit, so the disc fills a 1.9:1 crop

// Scrim. The galaxy is bright and unpredictable exactly where the wordmark
// sits, and without this the subtitle vanishes into the green arm.
const scrim = document.createElement('div');
scrim.style.cssText = [
  'position:fixed', 'left:0', 'right:0', 'bottom:0', 'height:52%',
  'z-index:99998', 'pointer-events:none',
  'background:linear-gradient(to top, rgba(3,4,10,0.94) 0%, rgba(3,4,10,0.72) 38%, rgba(3,4,10,0) 100%)',
].join(';');
document.body.append(scrim);

const plate = document.createElement('div');
plate.style.cssText = [
  'position:fixed', 'left:60px', 'bottom:52px', 'z-index:99999',
  "font-family:ui-sans-serif,Inter,system-ui,-apple-system,sans-serif",
  'pointer-events:none',
].join(';');

const title = document.createElement('div');
title.textContent = 'MAGIC CARD UNIVERSE';
title.style.cssText = [
  'font-size:46px', 'font-weight:300', 'letter-spacing:0.24em',
  'color:#eaf4ff', 'text-shadow:0 0 44px rgba(94,231,255,0.55)',
].join(';');

const sub = document.createElement('div');
sub.textContent = `${window.__mcu.universe.count.toLocaleString()} cards · one galaxy`;
sub.style.cssText = [
  'margin-top:18px', 'font-size:18px', 'letter-spacing:0.22em',
  'text-transform:uppercase', 'color:rgba(196,218,247,0.92)',
  'font-variant-numeric:tabular-nums',
].join(';');

plate.append(title, sub);
document.body.append(plate);
