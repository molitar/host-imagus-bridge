/* DEBUG STAGE STOP - edit this one line, then Reload the temporary add-on.
 * null = normal full scan.
 * Otherwise a scan runs detection ONLY up to and including that player type, logs a window/tab snapshot to
 * Downloads\HIB_SCANLOG.txt, and stops. Stages in order:
 *   'html5' -> 'jwplayer' -> 'videojs' -> 'plyr' -> 'hlsjs' -> 'dashjs' -> 'shaka' -> 'flowplayer' -> 'nplayer' -> 'iframe'
 * 'none' = stop right after the page loads, BEFORE any player probe (proves whether detection is involved at all).
 * Used to find which stage causes a tab/window to open or take focus. */
var HIB_DEBUG_STOP_AFTER = null;

/* Window type of the scan window: 'popup' (small, no toolbar) or 'normal' (an ordinary small window).
 * Try 'normal' if a popup window is being turned into a tab by Firefox / another extension. */
var HIB_DEBUG_WINDOW_TYPE = 'popup';

/* Scan surface: 'tab' = an unfocused background tab right next to the current tab (closed when the scan ends);
 * 'window' = a small popup window in the lower right. */
var HIB_DEBUG_SCAN_SURFACE = 'window';
