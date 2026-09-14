import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import vm from 'vm'

/**
 * The one script this site serves, actually run.
 *
 * Everything else about `templates/site.js` was asserted by reading its text —
 * that it contains `aria-busy`, that it does not contain `.disabled`. That is
 * worth something and it is not the same as knowing what it does, which is how
 * a real defect shipped: the spinner is cleared by the page being replaced, and
 * every POST on this site replaced the page until **Download profile**, which
 * answers with an attachment and leaves the document alone. The spinner spun
 * for ever, and the form stayed latched — so the *Submit* button silently
 * stopped working after anybody pressed Download.
 *
 * A grep would not have found that, because nothing about the text was wrong.
 * So this runs the script against a DOM small enough to reason about and asks
 * what happens.
 */

/** The smallest DOM this script can be judged against. */
function makeDom () {
  const listeners = { document: {}, window: {} }
  const element = (tag, attrs = {}, children = []) => {
    const self = {
      tagName: tag.toUpperCase(),
      attrs: { ...attrs },
      children,
      getAttribute: name => (name in self.attrs ? self.attrs[name] : null),
      hasAttribute: name => name in self.attrs,
      setAttribute: (name, value) => { self.attrs[name] = value },
      removeAttribute: name => { delete self.attrs[name] },
      querySelector: () => children.find(child => child.tagName === 'BUTTON') ?? null,
      querySelectorAll: selector => (selector === '[aria-busy]'
        ? children.filter(child => child.hasAttribute('aria-busy'))
        : [])
    }
    return self
  }
  const forms = []
  const context = {
    document: {
      addEventListener: (type, fn, capture) => { listeners.document[type] = fn },
      querySelectorAll: selector => (selector === 'form[data-busy]'
        ? forms.filter(form => form.hasAttribute('data-busy'))
        : [])
    },
    window: {
      addEventListener: (type, fn) => { listeners.window[type] = fn }
    }
  }
  return { context, listeners, element, forms }
}

const SOURCE = readFileSync('templates/site.js', 'utf8')

let dom
beforeEach(() => {
  dom = makeDom()
  vm.createContext(dom.context)
  vm.runInContext(SOURCE, dom.context)
})

/** Press `button` on `form`, and say whether the browser was allowed to submit. */
function press (form, button) {
  let prevented = false
  dom.listeners.document.submit({
    target: form,
    submitter: button,
    preventDefault: () => { prevented = true }
  })
  return !prevented
}

describe('the submit spinner', () => {
  it('marks the pressed button busy and lets the form go', () => {
    const button = dom.element('button')
    const form = dom.element('form', { method: 'post' }, [button])
    expect(press(form, button)).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(form.hasAttribute('data-busy')).toBe(true)
  })

  it('refuses the second press of a double click', () => {
    const button = dom.element('button')
    const form = dom.element('form', { method: 'post' }, [button])
    press(form, button)
    expect(press(form, button), 'the second press must not post the form again').toBe(false)
  })

  it('never disables the button, because the form dispatches on its value', () => {
    // Seven templates read the pressed button's own name and value, and a
    // disabled button is not submitted — so the usual double-post guard would
    // turn Accept into a fall-through.
    const button = dom.element('button', { name: 'decision', value: 'accept' })
    const form = dom.element('form', { method: 'post' }, [button])
    press(form, button)
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('leaves GET forms alone', () => {
    const button = dom.element('button')
    const form = dom.element('form', { method: 'get' }, [button])
    expect(press(form, button)).toBe(true)
    expect(button.hasAttribute('aria-busy')).toBe(false)
  })
})

describe('a button that downloads instead of navigating', () => {
  it('gets no spinner, because nothing would ever stop it', () => {
    const download = dom.element('button', { name: 'download', 'data-no-navigate': '' })
    const form = dom.element('form', { method: 'post' }, [download])
    expect(press(form, download)).toBe(true)
    expect(download.hasAttribute('aria-busy'),
      'a download leaves the page in place, so a spinner on it never stops').toBe(false)
  })

  it('does not latch the form, so Submit still works afterwards', () => {
    // The serious half of the defect. The stuck spinner was visible; this was
    // not — pressing Download left the form marked busy, and every later press
    // of Submit was refused with nothing shown to say why.
    const submit = dom.element('button')
    const download = dom.element('button', { name: 'download', 'data-no-navigate': '' })
    const form = dom.element('form', { method: 'post' }, [submit, download])
    press(form, download)
    expect(form.hasAttribute('data-busy')).toBe(false)
    expect(press(form, submit), 'Submit must still post after a download').toBe(true)
    expect(submit.getAttribute('aria-busy')).toBe('true')
  })

  it('can be pressed repeatedly, because each press is a new download', () => {
    const download = dom.element('button', { name: 'download', 'data-no-navigate': '' })
    const form = dom.element('form', { method: 'post' }, [download])
    for (let i = 0; i < 3; i++) expect(press(form, download), `press ${i + 1}`).toBe(true)
  })
})

describe('coming back to a page the browser kept', () => {
  it('unlatches the form, which would otherwise be dead with no sign of why', () => {
    const button = dom.element('button')
    const form = dom.element('form', { method: 'post' }, [button])
    dom.forms.push(form)
    press(form, button)
    expect(form.hasAttribute('data-busy')).toBe(true)

    dom.listeners.window.pageshow({ persisted: true })
    expect(form.hasAttribute('data-busy')).toBe(false)
    expect(button.hasAttribute('aria-busy')).toBe(false)
    expect(press(form, button), 'the form works again after Back').toBe(true)
  })

  it('does nothing on an ordinary load, which has nothing to clear', () => {
    const button = dom.element('button')
    const form = dom.element('form', { method: 'post' }, [button])
    dom.forms.push(form)
    press(form, button)
    dom.listeners.window.pageshow({ persisted: false })
    expect(form.hasAttribute('data-busy'),
      'a fresh document is a fresh form; this must not undo a live submission').toBe(true)
  })
})
