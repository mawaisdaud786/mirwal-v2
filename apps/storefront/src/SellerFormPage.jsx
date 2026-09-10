import { useState } from 'react'
import Header from './components/Header'
import Footer from './components/Footer'
import './seller-pages.css'
import { navigateTo } from '@mirwal/shared/navigation'
import { LoadingState, ErrorState } from '@mirwal/shared/PageStates'
import { useApiQuery, describeApiError } from '@mirwal/shared/useApiQuery'
import { useSession } from './components/useSession'
import api from './api'

/**
 * The seller application.
 *
 * This page previously collected fifteen fields and threw them away: `submit()` set a boolean
 * and rendered "Application submitted. Our seller team will contact you soon." Nothing was
 * sent, no record existed, and the admin panel's Applications queue reviewed a list that
 * production could never fill.
 *
 * It now posts to `POST /sell/application`. Three things shape the design:
 *
 *   * **The checklist comes first.** Email and phone must be confirmed before an application
 *     can be submitted, so the page asks the server what is outstanding and shows it up front
 *     rather than rejecting a completed form at the last step — which is where applicants are
 *     lost.
 *
 *   * **Individual and business ask for different things.** A hobby seller in Lahore is not
 *     asked for a certificate of incorporation. The fields shown follow the seller type, and
 *     the server enforces the same rule so a crafted request cannot skip it.
 *
 *   * **No bank details.** Deliberately not collected here. Nobody is owed money yet, and
 *     asking for an IBAN at signup is the single largest drop-off point in Pakistani seller
 *     onboarding. It is requested later, before the first withdrawal.
 */

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

const sellerBenefits = [
  ['users', 'Millions of Customers', 'Reach millions of active buyers across Pakistan.'],
  ['circle-check', 'Zero Setup Fee', 'Start your business on Mirwal with zero setup fee.'],
  ['shield-halved', 'Low Commission', 'Competitive commission rates with no hidden charges.'],
  ['wallet', 'Secure Payments', 'Get paid safely and on time with protected transactions.'],
  ['headset', 'Seller Support', 'Dedicated support team to help you grow your business.'],
]

const PROVINCES = [
  'Punjab', 'Sindh', 'Khyber Pakhtunkhwa', 'Balochistan',
  'Gilgit-Baltistan', 'Azad Jammu & Kashmir', 'Islamabad Capital Territory',
]

const BUSINESS_TYPES = [
  ['sole_proprietor', 'Sole proprietor'],
  ['partnership', 'Partnership / AOP'],
  ['private_limited', 'Private limited company'],
  ['other', 'Other'],
]

function Field({ label, children, wide = false, required = true, hint }) {
  const [showInfo, setShowInfo] = useState(false)
  return (
    <div className={wide ? 'seller-field wide' : 'seller-field'}>
      <label><span>{label} {required && <em>*</em>}</span>{children}</label>
      {hint && <button className="seller-field-info" type="button" aria-label={`More information about ${label}`} aria-expanded={showInfo} onClick={() => setShowInfo((visible) => !visible)}><FaIcon name="circle-info" /></button>}
      {hint && <small className={showInfo ? 'seller-field-hint is-visible' : 'seller-field-hint'}>{hint}</small>}
    </div>
  )
}

/**
 * Drop the empty optionals before posting.
 *
 * The form keeps every field as a string so the inputs stay controlled, but the API's optional
 * enums (`businessType`) and optional identifiers reject `''` — it is neither a valid value nor
 * absent. Sending it produced a validation error naming a field an individual applicant cannot
 * even see.
 */
function toPayload(form) {
  const payload = { ...form }
  for (const key of ['businessType', 'businessRegNo', 'ntn', 'strn', 'cnic', 'dateOfBirth']) {
    if (payload[key] === '') payload[key] = null
  }
  // Business-only fields have no meaning on an individual application, and leaving stale
  // values in place after switching type would submit details the applicant did not intend.
  if (payload.sellerType !== 'business') {
    payload.legalName = ''
    payload.businessType = null
    payload.businessRegNo = null
    payload.ntn = null
    payload.strn = null
  } else {
    // A business applicant does not fill in a date of birth; the field is not shown.
    payload.dateOfBirth = payload.dateOfBirth || null
  }
  return payload
}

const EMPTY = {
  sellerType: 'individual',
  applicantName: '',
  applicantEmail: '',
  applicantPhone: '',
  cnic: '',
  dateOfBirth: '',
  storeName: '',
  legalName: '',
  businessType: '',
  businessRegNo: '',
  ntn: '',
  strn: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  province: '',
  postalCode: '',
  categories: '',
  website: '',
  notes: '',
  heardFrom: '',
}

const DOCUMENT_GUIDANCE = {
  individual: [
    ['CNIC front and back', 'Clear photos or scans of both sides of your CNIC.'],
    ['Proof of address', 'Keep a recent utility bill or bank statement available if requested.'],
  ],
  business: [
    ['CNIC front and back', 'Clear photos or scans of the owner or authorised representative.'],
    ['Business registration', 'SECP certificate, partnership deed, or other registration proof.'],
    ['NTN / tax certificate', 'Your FBR/NTN certificate or tax registration document.'],
  ],
}

export default function SellerFormPage() {
  const { user } = useSession()
  const {
    data: requirements, error: requirementsError, isLoading, refetch,
  } = useApiQuery((signal) => api.sell.requirements(signal), [user?.id], { enabled: Boolean(user) })

  const [form, setForm] = useState(EMPTY)
  const [accepted, setAccepted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  // Field-level messages from the server, so a rejected CNIC is shown against the CNIC box
  // rather than as one anonymous banner at the top of a twenty-field form.
  const [fieldErrors, setFieldErrors] = useState({})
  const [submittedReference, setSubmittedReference] = useState(null)

  const set = (key) => (event) => {
    setForm((current) => ({ ...current, [key]: event.target.value }))
    setFieldErrors((current) => ({ ...current, [key]: undefined }))
  }

  const isBusiness = form.sellerType === 'business'

  async function submit(event) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setFieldErrors({})
    try {
      const result = await api.sell.apply({ ...toPayload(form), acceptedTerms: accepted })
      setSubmittedReference(result.data?.reference ?? result.reference ?? null)
    } catch (apiError) {
      // The server returns per-field details for a validation failure; surface them where the
      // applicant can act on them.
      const details = apiError?.details ?? []
      if (details.length) {
        setFieldErrors(Object.fromEntries(details.map((detail) => [detail.field, detail.message])))
      }
      /**
       * Say what is wrong, not merely that something is.
       *
       * A field error can name a field this form is not currently showing — a stale
       * business-only field on an individual application, say. Falling back to the bare
       * "Some fields need attention" would leave the applicant staring at a valid-looking
       * form with no highlighted input and no way forward.
       */
      const unshown = details.filter((detail) => !(detail.field in form))
      setError(
        unshown.length
          ? `${describeApiError(apiError)} ${unshown.map((detail) => detail.message).join(' ')}`
          : describeApiError(apiError),
      )
    } finally {
      setSubmitting(false)
    }
  }

  // --- gates -----------------------------------------------------------------

  if (!user) {
    return (
      <>
        <Header />
        <main className="seller-form-page">
          <div className="container">
            <div className="seller-form-heading">
              <div>
                <h1><span><FaIcon name="store" /></span> Start Selling with <b>Mirwal</b></h1>
                <p>Create a Mirwal account or sign in, and you can apply in a few minutes.</p>
              </div>
            </div>
            <div className="seller-gate">
              <button type="button" className="seller-primary" onClick={() => navigateTo('/login?next=/sell-with-mirwal/apply')}>
                Sign in to apply
              </button>
              <button type="button" onClick={() => navigateTo('/register?next=/sell-with-mirwal/apply')}>
                Create an account
              </button>
            </div>
          </div>
        </main>
        <Footer />
      </>
    )
  }

  if (isLoading) return <><Header /><LoadingState label="Loading your application" /><Footer /></>
  if (requirementsError) {
    return (
      <>
        <Header />
        <ErrorState
          title="We could not load the application form"
          description={describeApiError(requirementsError)}
          onRetry={refetch}
        />
        <Footer />
      </>
    )
  }

  if (requirements?.hasStore) {
    return <StatusPanel
      icon="store"
      title="You already have a Mirwal store"
      body="Sign in to the seller panel to manage your listings and orders."
      actionLabel="Go to Seller Centre"
      onAction={() => { window.location.href = '/seller-center' }}
    />
  }

  if (submittedReference || requirements?.hasApplication) {
    return <ApplicationStatus reference={submittedReference} status={requirements?.applicationStatus} />
  }

  const outstanding = (requirements?.steps ?? []).filter((step) => step.required && !step.done && step.key !== 'application')

  return (
    <>
      <Header />
      <main className="seller-form-page">
        <div className="container">
          <div className="seller-breadcrumb">
            <button type="button" onClick={() => navigateTo('/')}>Home</button>
            <span>›</span>
            <button type="button" onClick={() => navigateTo('/sell-with-mirwal')}>Sell with Us</button>
            <span>›</span>Application Form
          </div>

          <div className="seller-form-heading">
            <div>
              <h1><span><FaIcon name="store" /></span> Start Selling with <b>Mirwal</b></h1>
              <p>Join thousands of successful sellers and grow your business with Pakistan&apos;s trusted marketplace.</p>
            </div>
            <aside>
              <b>Need help?</b>
              <small>Our support team is here to assist you.</small>
              <button type="button" onClick={() => navigateTo('/help-center')}><FaIcon name="headset" /> Contact Support</button>
            </aside>
          </div>

          {/*
            The checklist. Shown before the form rather than as a rejection after it — an
            applicant who fills in twenty fields and is then told to confirm their email is an
            applicant who does not come back.
          */}
          {outstanding.length > 0 && (
            <section className="seller-checklist" role="status">
              <h2><FaIcon name="circle-exclamation" /> Two quick things first</h2>
              <ul>
                {(requirements?.steps ?? []).filter((step) => step.required && step.key !== 'application').map((step) => (
                  <li key={step.key} className={step.done ? 'done' : ''}>
                    <FaIcon name={step.done ? 'circle-check' : 'circle'} />
                    <span>{step.label}</span>
                    {!step.done && (
                      <button type="button" onClick={() => navigateTo('/security')}>Confirm now</button>
                    )}
                  </li>
                ))}
              </ul>
              <p>We need these so we can tell you the outcome of your application.</p>
            </section>
          )}

          <div className="seller-form-layout">
            <form className="seller-application" onSubmit={submit}>
              <h2>Tell us about your business</h2>
              <p>Please fill in the details below to create your seller account.</p>

              <fieldset>
                <legend>1. How are you selling?</legend>
                <div className="seller-type-choice">
                  {[['individual', 'As an individual', 'You sell under your own name using your CNIC.'],
                    ['business', 'As a registered business', 'You have an NTN and trade under a business name.']].map(([value, label, detail]) => (
                      <button
                        type="button"
                        key={value}
                        className={form.sellerType === value ? 'selected' : ''}
                        onClick={() => setForm((current) => ({ ...current, sellerType: value }))}
                        aria-pressed={form.sellerType === value}
                      >
                        <b>{label}</b>
                        <small>{detail}</small>
                      </button>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend>2. Personal Information</legend>
                <div className="seller-form-grid">
                  <Field label="Full Name (as on CNIC)" hint={fieldErrors.applicantName}>
                    <input required value={form.applicantName} onChange={set('applicantName')} placeholder="Enter your full name" />
                  </Field>
                  <Field label="Email Address" hint={fieldErrors.applicantEmail}>
                    <input required type="email" value={form.applicantEmail} onChange={set('applicantEmail')} placeholder="you@example.com" />
                  </Field>
                  <Field label="Phone Number" hint={fieldErrors.applicantPhone}>
                    <input required value={form.applicantPhone} onChange={set('applicantPhone')} placeholder="03XX XXXXXXX" />
                  </Field>
                  <Field
                    label={isBusiness ? "Owner's CNIC" : 'CNIC / National ID'}
                    hint={fieldErrors.cnic ?? 'Digits only or with dashes — either is fine.'}
                  >
                    <input required value={form.cnic} onChange={set('cnic')} placeholder="12345-6789012-3" inputMode="numeric" />
                  </Field>
                  {!isBusiness && (
                    <Field label="Date of Birth" hint={fieldErrors.dateOfBirth}>
                      <input required type="date" value={form.dateOfBirth} onChange={set('dateOfBirth')} />
                    </Field>
                  )}
                </div>
              </fieldset>

              <fieldset>
                <legend>3. Store Information</legend>
                <div className="seller-form-grid">
                  <Field label="Store Name" hint={fieldErrors.storeName ?? 'This is what buyers will see.'}>
                    <input required value={form.storeName} onChange={set('storeName')} placeholder="Enter your store name" />
                  </Field>

                  {isBusiness && (
                    <>
                      <Field label="Registered Business Name" hint={fieldErrors.legalName}>
                        <input required value={form.legalName} onChange={set('legalName')} placeholder="As registered with SECP / FBR" />
                      </Field>
                      <Field label="Business Type" hint={fieldErrors.businessType}>
                        <select required value={form.businessType} onChange={set('businessType')}>
                          <option value="" disabled>Select business type</option>
                          {BUSINESS_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </Field>
                      <Field label="NTN" hint={fieldErrors.ntn}>
                        <input required value={form.ntn} onChange={set('ntn')} placeholder="1234567-8" />
                      </Field>
                      {form.businessType === 'private_limited' && (
                        <Field label="Company Registration Number" hint={fieldErrors.businessRegNo}>
                          <input required value={form.businessRegNo} onChange={set('businessRegNo')} placeholder="SECP registration number" />
                        </Field>
                      )}
                      <Field label="Sales Tax Number (STRN)" required={false} hint="Only if you are registered for sales tax.">
                        <input value={form.strn} onChange={set('strn')} placeholder="Optional" />
                      </Field>
                    </>
                  )}

                  <Field label="What do you sell?" wide hint={fieldErrors.categories}>
                    <input required value={form.categories} onChange={set('categories')} placeholder="e.g. Electronics, Fashion, Home Appliances" />
                  </Field>
                </div>
              </fieldset>

              <fieldset>
                <legend>4. Address</legend>
                <div className="seller-form-grid">
                  <Field label="Address" wide hint={fieldErrors.addressLine1}>
                    <input required value={form.addressLine1} onChange={set('addressLine1')} placeholder="House / shop number, street, area" />
                  </Field>
                  <Field label="Area / Landmark" required={false}>
                    <input value={form.addressLine2} onChange={set('addressLine2')} placeholder="Optional" />
                  </Field>
                  <Field label="City" hint={fieldErrors.city}>
                    <input required value={form.city} onChange={set('city')} placeholder="e.g. Lahore" />
                  </Field>
                  <Field label="Province" hint={fieldErrors.province}>
                    <select required value={form.province} onChange={set('province')}>
                      <option value="" disabled>Select province</option>
                      {PROVINCES.map((province) => <option key={province}>{province}</option>)}
                    </select>
                  </Field>
                  <Field label="Postal Code" required={false}>
                    <input value={form.postalCode} onChange={set('postalCode')} placeholder="Optional" />
                  </Field>
                </div>
              </fieldset>

              <fieldset>
                <legend>5. Anything else?</legend>
                <div className="seller-form-grid">
                  <Field label="How did you hear about Mirwal?" required={false}>
                    <select value={form.heardFrom} onChange={set('heardFrom')}>
                      <option value="">Select an option</option>
                      <option>Search engine</option>
                      <option>Social media</option>
                      <option>Friend or colleague</option>
                      <option>Another seller</option>
                      <option>Other</option>
                    </select>
                  </Field>
                  <Field label="Existing website or shop" required={false}>
                    <input value={form.website} onChange={set('website')} placeholder="Optional" />
                  </Field>
                  <Field label="Additional Information" wide required={false}>
                    <textarea value={form.notes} onChange={set('notes')} placeholder="Tell us more about your business..." />
                  </Field>
                </div>
              </fieldset>

              <section className="seller-document-guide" aria-labelledby="seller-document-guide-title">
                <h3 id="seller-document-guide-title"><FaIcon name="file-shield" /> Documents you may need</h3>
                <p>We will request secure uploads in Seller Centre when your application reaches verification. Prepare these now; do not email identity documents.</p>
                <ul>{DOCUMENT_GUIDANCE[form.sellerType].map(([title, detail]) => <li key={title}><FaIcon name="file-circle-check" /><span><b>{title}</b><small>{detail}</small></span></li>)}</ul>
              </section>

              <label className="seller-agreement">
                <input required type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
                {' '}I agree to Mirwal&apos;s{' '}
                <button type="button" onClick={() => navigateTo('/terms')}>Terms of Use</button>
                {' '}and{' '}
                <button type="button" onClick={() => navigateTo('/privacy')}>Privacy Policy</button>.
              </label>

              <div className="seller-form-actions">
                <button type="reset" onClick={() => { setForm(EMPTY); setAccepted(false) }}>Clear Form</button>
                <button className="seller-primary" type="submit" disabled={submitting || outstanding.length > 0}>
                  {submitting ? 'Submitting…' : <>Submit Application <FaIcon name="paper-plane" /></>}
                </button>
              </div>

              {outstanding.length > 0 && (
                <p className="seller-submit-message" role="status">
                  Confirm your {outstanding.map((step) => step.key).join(' and ')} above, then you can submit.
                </p>
              )}
              {error && <p className="seller-submit-message error" role="alert">{error}</p>}
            </form>

            <aside className="seller-form-sidebar">
              <section>
                <h2>Why Sell with Mirwal?</h2>
                {sellerBenefits.map(([icon, title, detail]) => (
                  <div key={title}>
                    <span><FaIcon name={icon} /></span>
                    <p><b>{title}</b><small>{detail}</small></p>
                  </div>
                ))}
              </section>
              <section className="seller-how">
                <h2>How it Works</h2>
                {[['Apply', 'user-plus'], ['Review', 'magnifying-glass'], ['Get Approved', 'circle-check'], ['Start Selling', 'chart-line']].map(([step, icon], index) => (
                  <div key={step}>
                    <b><span>{index + 1}</span><FaIcon name={icon} /></b>
                    <p>
                      <strong>{step}</strong>
                      <small>{[
                        'Fill out the application form and submit.',
                        'Our team reviews it, usually within two working days.',
                        'Once approved, set up your store and add your payout account.',
                        'List your products and start earning.',
                      ][index]}</small>
                    </p>
                  </div>
                ))}
              </section>
            </aside>
          </div>

          <p className="seller-privacy">
            <FaIcon name="lock" /> Your CNIC and business details are used only to verify your
            store. They are never shown to buyers.
          </p>
        </div>
      </main>
      <Footer />
    </>
  )
}

function StatusPanel({ icon, title, body, actionLabel, onAction, tone = 'info' }) {
  return (
    <>
      <Header />
      <main className="seller-form-page">
        <div className="container">
          <section className={`seller-status seller-status-${tone}`}>
            <div className="seller-status-icon"><FaIcon name={icon} /></div>
            <h1>{title}</h1>
            <p>{body}</p>
            {actionLabel && (
              <button type="button" className="seller-primary" onClick={onAction}>{actionLabel}</button>
            )}
          </section>
        </div>
      </main>
      <Footer />
    </>
  )
}

/**
 * Where an application stands.
 *
 * Reads the live record rather than trusting what the form just posted, so a page refresh — or
 * a return visit days later — shows the current decision including anything the reviewer has
 * asked for.
 */
function ApplicationStatus({ reference }) {
  const { data: application, isLoading, refetch } = useApiQuery((signal) => api.sell.application(signal), [])
  const [withdrawing, setWithdrawing] = useState(false)

  if (isLoading) return <><Header /><LoadingState label="Loading your application" /><Footer /></>

  const status = application?.status ?? 'submitted'
  const copy = {
    submitted: {
      icon: 'clock', tone: 'info', title: 'Your application is with our team',
      body: 'Most applications are reviewed within two working days. We will email you as soon as there is a decision.',
    },
    in_review: {
      icon: 'magnifying-glass', tone: 'info', title: 'A reviewer is looking at your application',
      body: 'We will be in touch shortly.',
    },
    more_info_required: {
      icon: 'circle-exclamation', tone: 'warn', title: 'We need a little more information',
      body: application?.infoRequested ?? 'Please check your email for what we need.',
    },
    approved: {
      icon: 'circle-check', tone: 'good', title: 'Your store is approved',
      body: 'Sign in to the seller panel to add your payout account and list your first product.',
    },
    rejected: {
      icon: 'circle-xmark', tone: 'bad', title: 'Your application was not approved',
      body: application?.decisionNote
        ?? 'Unfortunately we could not approve this application. You are welcome to apply again with corrected details.',
    },
    withdrawn: {
      icon: 'circle-minus', tone: 'info', title: 'Application withdrawn',
      body: 'You can start a new application whenever you are ready.',
    },
    expired: {
      icon: 'hourglass-end', tone: 'info', title: 'Application expired',
      body: 'We did not hear back, so this application was closed. You can apply again.',
    },
  }[status] ?? {
    icon: 'clock', tone: 'info', title: 'Application received', body: 'We will be in touch.',
  }

  const quotable = reference ?? application?.reference

  return (
    <>
      <Header />
      <main className="seller-form-page">
        <div className="container">
          <section className={`seller-status seller-status-${copy.tone}`}>
            <div className="seller-status-icon"><FaIcon name={copy.icon} /></div>
            <h1>{copy.title}</h1>
            <p>{copy.body}</p>
            {quotable && <p className="seller-status-reference">Reference <b>{quotable}</b></p>}

            {status === 'more_info_required' && (
              <button type="button" className="seller-primary" onClick={() => window.location.reload()}>
                Update my application
              </button>
            )}
            {status === 'approved' && (
              <button type="button" className="seller-primary" onClick={() => { window.location.href = '/seller-center' }}>
                Go to Seller Centre
              </button>
            )}
            {['submitted', 'in_review', 'more_info_required'].includes(status) && (
              <button
                type="button"
                className="seller-status-withdraw"
                disabled={withdrawing}
                onClick={async () => {
                  // Irreversible enough to confirm: withdrawing closes the case and the
                  // applicant has to start again from an empty form.
                  if (!window.confirm('Withdraw your application? You will need to apply again from the start.')) return
                  setWithdrawing(true)
                  try { await api.sell.withdraw(); refetch() } finally { setWithdrawing(false) }
                }}
              >
                {withdrawing ? 'Withdrawing…' : 'Withdraw application'}
              </button>
            )}
          </section>
        </div>
      </main>
      <Footer />
    </>
  )
}
