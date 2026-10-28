import './about.css';
import { el } from '../../dom';
import { usdFmt } from '../../format';
import { drawTradeLegend, LEGEND_INSET_PX, LEGEND_ROW_PX, tradeLegend } from '../../scene/legend';
import { type Modal, mountModal } from '../modal/modal';

/**
 * The About dialog, opened from the ? button. Its text is static in index.html on purpose:
 * crawlers that skip JavaScript read what the app does from it. The trade legend's marks, captions
 * and note follow the large trade threshold, so they are drawn each time the dialog opens.
 */
export function mountAbout(bigTradeUsd: () => number): Modal {
  const legend = el('legend');
  const marksCanvas = el<HTMLCanvasElement>('legend-marks');
  const captions = el('legend-captions');
  const note = el('legend-note');
  legend.style.setProperty('--legend-row', `${LEGEND_ROW_PX}px`);
  legend.style.setProperty('--legend-inset', `${LEGEND_INSET_PX}px`);
  return mountModal('about', 'about-open', () => {
    const big = bigTradeUsd();
    const marks = tradeLegend(big);
    legend.style.setProperty('--legend-cols', String(marks.length));
    captions.replaceChildren(
      ...marks.map((m) => {
        const caption = document.createElement('span');
        caption.textContent = m.caption;
        return caption;
      }),
    );
    note.textContent = `Glow: ${usdFmt.format(big)} and up, set in Settings.`;
    drawTradeLegend(marksCanvas, marks);
  });
}
