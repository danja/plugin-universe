/**
 * The only JavaScript this site serves, and it does one thing.
 *
 * Submitting a plugin takes a few seconds — the store is written, the shapes are
 * checked, and an accepted submission is embedded and indexed before the page
 * comes back. Until now nothing happened on screen in that time, which reads as
 * a dead button and invites a second click.
 *
 * **Progressive enhancement, strictly.** Every form here works with this file
 * blocked, missing or disabled: it is server-rendered HTML posting to a route,
 * and this adds a spinner to the button and nothing else. Nothing on this site
 * requires JavaScript to function, and this does not change that.
 *
 * **It must not disable the button.** Seven templates dispatch on the submit
 * button's own `name` and `value` — `name="decision" value="accept"`,
 * `name="promote"`, `name="readbundle"` — and a disabled button is not
 * submitted with the form. Disabling it, which is the usual way to stop a
 * double post, would drop the field that says *which action this is* and turn
 * Accept into a fall-through. So the button stays enabled and the second submit
 * is refused instead.
 *
 * Delegated from the document rather than bound per form: a page can render a
 * queue of twenty forms, and one listener is cheaper than twenty.
 */
document.addEventListener('submit', function (event) {
  var form = event.target
  if (!form || form.tagName !== 'FORM') return

  // GET forms — the search box, the facet selects — answer immediately and
  // navigate. A spinner on those would flash and mean nothing.
  if ((form.getAttribute('method') || 'get').toLowerCase() !== 'post') return

  // `submitter` is the button actually pressed, which matters on the admin
  // panels where one form has two of them and they mean opposite things.
  var button = event.submitter ||
    form.querySelector('button[type="submit"], button:not([type])')

  // A button whose response does not replace the page.
  //
  // The whole mechanism below rests on an assumption that was true of every
  // form here until Download profile: that a POST ends in a navigation, so the
  // document is discarded and the spinner goes with it. A download answers with
  // `Content-Disposition: attachment`, which downloads the file and leaves the
  // page exactly where it is — so the spinner spun for ever, and, worse, the
  // form stayed latched and **every later press of Submit was refused**. The
  // button that saves the plugin stopped working because a different button had
  // been pressed first.
  //
  // Declared on the button rather than recognised by name: the script has no
  // business knowing what `name="download"` means, and the next such button
  // should only have to say so.
  if (button && button.hasAttribute('data-no-navigate')) return

  // The second press of a double click. The first submission is already on its
  // way; letting this one through would post the form twice.
  if (form.hasAttribute('data-busy')) {
    event.preventDefault()
    return
  }
  form.setAttribute('data-busy', '')

  if (button) button.setAttribute('aria-busy', 'true')
}, true)

/**
 * Unlatch a form when the page comes back from the browser's cache.
 *
 * Submit, then press Back: the browser may restore this very document rather
 * than re-rendering it, `data-busy` still set from the submission that took the
 * reader away. The form is then dead in the same way, for a reason nobody could
 * guess. `persisted` is what distinguishes a restored page from a fresh load.
 */
window.addEventListener('pageshow', function (event) {
  if (!event.persisted) return
  var forms = document.querySelectorAll('form[data-busy]')
  for (var i = 0; i < forms.length; i++) {
    forms[i].removeAttribute('data-busy')
    var busy = forms[i].querySelectorAll('[aria-busy]')
    for (var j = 0; j < busy.length; j++) busy[j].removeAttribute('aria-busy')
  }
})
