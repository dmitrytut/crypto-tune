import './about.css';
import { type Modal, mountModal } from '../modal/modal';

/**
 * The About dialog, opened from the ? button. Its text is static in index.html on purpose:
 * crawlers that skip JavaScript read what the app does from it.
 */
export function mountAbout(): Modal {
  return mountModal('about', 'about-open');
}
