/**
 * AevumPay — embeddable checkout
 * ==============================
 *
 * Drop this on any merchant site and open the hosted checkout in an overlay:
 *
 *   <script src="https://aevumpay-app.vercel.app/sdk.js"></script>
 *   <button data-aevumpay-invoice="INVOICE_ID">Pay now</button>
 *
 * or call it directly:
 *
 *   AevumPay.checkout({ invoiceId: "INVOICE_ID" })
 *   AevumPay.close()
 *
 * The overlay loads /pay/<invoiceId>, which does the wallet connection and the
 * on-chain settlement. When the invoice is paid the iframe posts
 * `aevumpay:paid` and the overlay closes by itself.
 */
(function () {
  'use strict'

  if (window.AevumPay) return

  var BASE = (function () {
    var script = document.currentScript
    try {
      return new URL(script.src).origin
    } catch (e) {
      return 'https://aevumpay-app.vercel.app'
    }
  })()

  var overlay = null
  var frame = null
  var activeInvoice = null

  function build() {
    if (overlay) return

    overlay = document.createElement('div')
    overlay.setAttribute('role', 'dialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483000',
      'display:none', 'align-items:center', 'justify-content:center',
      'padding:16px', 'background:rgba(4,8,12,0.72)',
      'backdrop-filter:blur(6px)', '-webkit-backdrop-filter:blur(6px)',
    ].join(';')

    var panel = document.createElement('div')
    panel.style.cssText = [
      'position:relative', 'width:100%', 'max-width:460px',
      'height:min(760px, 92vh)', 'background:#080c10',
      'border:1px solid rgba(255,255,255,0.08)', 'border-radius:18px',
      'overflow:hidden', 'box-shadow:0 30px 80px rgba(0,0,0,0.6)',
    ].join(';')

    frame = document.createElement('iframe')
    frame.setAttribute('title', 'AevumPay checkout')
    frame.style.cssText = 'width:100%;height:100%;border:0;background:#080c10'
    frame.setAttribute('allow', 'clipboard-write')

    var closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.setAttribute('aria-label', 'Close checkout')
    closeBtn.innerHTML = '&times;'
    closeBtn.style.cssText = [
      'position:absolute', 'top:8px', 'right:10px', 'z-index:2',
      'width:32px', 'height:32px', 'border-radius:999px', 'cursor:pointer',
      'border:1px solid rgba(255,255,255,0.12)', 'background:rgba(0,0,0,0.5)',
      'color:#e5e7eb', 'font-size:20px', 'line-height:1',
    ].join(';')
    closeBtn.onclick = close

    panel.appendChild(frame)
    panel.appendChild(closeBtn)
    overlay.appendChild(panel)
    document.body.appendChild(overlay)

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close()
    })

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close()
    })

    window.addEventListener('message', function (e) {
      var data = e.data || {}
      if (e.origin === BASE && e.source === frame.contentWindow && activeInvoice &&
          data.type === 'aevumpay:paid' && data.invoiceId === activeInvoice) {
        var settledInvoice = activeInvoice
        setTimeout(function () { if (activeInvoice === settledInvoice) close() }, 1200)
      }
    })
  }

  function checkout(options) {
    var id = typeof options === 'string' ? options : options && options.invoiceId
    if (!id) {
      console.error('[AevumPay] checkout() needs an invoiceId')
      return
    }
    build()
    activeInvoice = String(id)
    frame.src = BASE + '/pay/' + encodeURIComponent(activeInvoice)
    overlay.style.display = 'flex'
    document.documentElement.style.overflow = 'hidden'
  }

  function close() {
    if (!overlay) return
    overlay.style.display = 'none'
    activeInvoice = null
    if (frame) frame.src = 'about:blank'
    document.documentElement.style.overflow = ''
  }

  window.AevumPay = {
    checkout: checkout,
    close: close,
    baseUrl: BASE,
  }

  // Auto-bind: any element with data-aevumpay-invoice opens the checkout.
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-aevumpay-invoice]') : null
    if (!el) return
    e.preventDefault()
    checkout(el.getAttribute('data-aevumpay-invoice'))
  })
})()
