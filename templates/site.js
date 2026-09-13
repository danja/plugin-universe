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

  // The second press of a double click. The first submission is already on its
  // way; letting this one through would post the form twice.
  if (form.hasAttribute('data-busy')) {
    event.preventDefault()
    return
  }
  form.setAttribute('data-busy', '')

  // `submitter` is the button actually pressed, which matters on the admin
  // panels where one form has two of them and they mean opposite things.
  var button = event.submitter ||
    form.querySelector('button[type="submit"], button:not([type])')
  if (button) button.setAttribute('aria-busy', 'true')
}, true)
