const promptEl = document.getElementById('prompt')

let promptTimeout = null

// ---------------------------------------------------------------------------
// Narrative prompts
// ---------------------------------------------------------------------------

/**
 * Show a message in the bottom prompt bar.
 * Automatically hides after `duration` ms (0 = stay until hidePrompt()).
 * @param {string} message
 * @param {number} [duration=0]
 */
export function showPrompt(message, duration = 0) {
  if (promptTimeout) clearTimeout(promptTimeout)

  promptEl.textContent = message
  promptEl.classList.add('visible')

  if (duration > 0) {
    promptTimeout = setTimeout(hidePrompt, duration)
  }
}

/**
 * Hide the prompt bar.
 */
export function hidePrompt() {
  promptEl.classList.remove('visible')
}
