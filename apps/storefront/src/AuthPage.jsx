import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { navigateTo } from '@mirwal/shared/navigation'
import { useSession } from './components/useSession'
import { describeApiError } from '@mirwal/shared/useApiQuery'
import api, { ApiError } from './api'

/**
 * Sign in / create account — previously honestly disconnected ("Authentication is not
 * connected yet"), now wired to the real `/auth/login` and `/auth/register` endpoints via
 * `useSession()`. See PROJECT_AUDIT.md S21: this is the missing half of the frontend
 * route-guard security finding — the guards now check a real session, but until this page
 * could actually produce one, nobody could reach any of the pages behind them.
 *
 * Login only ever accepts email (`loginSchema` on the server has no phone lookup), so the
 * field is labelled accordingly rather than the old "Email or Phone Number", which implied
 * phone sign-in that was never supported. Phone stays an optional field on sign-up, matching
 * `registerSchema`.
 *
 * Social sign-in and "Forgot Password?" have no backend behind them (no OAuth provider, no
 * password-reset endpoint) — clicking them says so rather than doing nothing silently.
 */

const FaIcon = ({ name }) => <i className={`fa-solid fa-${name}`} aria-hidden="true" />

function navigate(path) { navigateTo(path) }

const benefits = [
  ['tag', 'Exclusive Deals', 'Access members-only offers and discounts.'],
  ['heart', 'Save & Compare', 'Save products, compare and choose the best.'],
  ['truck-fast', 'Track Orders', 'Track your orders in real-time and get updates.'],
  ['shield-halved', 'Secure & Safe', 'Your account details stay private to you.'],
]

function Brand() {
  return <button className="auth-brand" type="button" onClick={() => navigate('/')}><span className="brand-mark">M</span><span><b>MIRWAL</b><small>Smart Shopping. Better Living.</small></span></button>
}

export default function AuthPage({ initialMode = 'signin' }) {
  const location = useLocation()
  const { login, register } = useSession()
  const [mode, setMode] = useState(initialMode)
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  /**
   * The second factor.
   *
   * The first attempt is deliberately made without a code: the API answers
   * TWO_FACTOR_REQUIRED and only then does the form ask. Sending one speculatively would tell
   * an attacker which accounts are enrolled, which is why the API is built that way — and
   * until now no login page implemented the other half, so switching two-factor on locked
   * the account out permanently.
   */
  const [twoFactorRequired, setTwoFactorRequired] = useState(false)
  const [totpCode, setTotpCode] = useState('')
  const isSignUp = mode === 'signup'
  const isForgot = mode === 'forgot'

  function switchMode(nextMode) {
    setMode(nextMode)
    setMessage('')
    setTwoFactorRequired(false)
    setTotpCode('')
    navigateTo(nextMode === 'signup' ? '/register' : '/login', { replace: true })
  }

  // `PrivateAccountRoute` reactively redirects to /login with `state.from` set to whatever
  // protected path just lost its session — including /logout itself, since clicking "Logout"
  // clears the session while still mounted on that route. Landing back on the "are you sure
  // you want to logout?" screen right after signing back in would be a confusing destination,
  // not a real one to return to.
  const destination = () => {
    const from = location.state?.from
    return from && from !== '/logout' ? from : '/'
  }

  async function submit(event) {
    event.preventDefault()
    setMessage('')

    if (isSignUp && password !== confirmPassword) {
      setMessage('Passwords do not match.')
      return
    }

    setSubmitting(true)
    try {
      if (isSignUp) {
        await register({ fullName, email, password, phone: phone || undefined })
      } else {
        await login({ email, password, ...(totpCode ? { totpCode: totpCode.trim() } : {}) })
      }
      navigateTo(destination(), { replace: true })
    } catch (error) {
      if (error instanceof ApiError && error.code === 'TWO_FACTOR_REQUIRED') {
        // Not a failure — the password was right and the account has a second factor. Asking
        // rather than reporting an error is the difference between a working sign-in and a
        // user who believes their password is wrong.
        setTwoFactorRequired(true)
        setMessage('')
      } else {
        if (error instanceof ApiError && error.code === 'INVALID_TWO_FACTOR') setTotpCode('')
        setMessage(error instanceof ApiError ? describeApiError(error) : 'Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  /**
   * Ask for a reset link.
   *
   * The API answers identically whether or not the address has an account, so this message
   * has to as well — anything more specific would turn the form into a way to find out who
   * shops on Mirwal.
   */
  const sendReset = async (event) => {
    event.preventDefault()
    setSubmitting(true)
    setMessage('')
    try {
      const result = await api.auth.forgotPassword(email)
      setMessage(result.message)
    } catch (error) {
      setMessage(error instanceof ApiError ? describeApiError(error) : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="auth-page"><div className="auth-topbar"><Brand /><div><span>Need help?</span><button type="button"><FaIcon name="headset" /> Help & Support</button><button type="button" onClick={() => navigate('/')}><FaIcon name="house" /> Back to Home</button></div></div><div className="auth-shell"><aside className="auth-pitch"><div><h1>Smart Shopping<br /><span>Starts Here</span></h1><p>Sign in to access the best deals, compare products, track orders and enjoy a smarter way to shop.</p><div className="auth-benefits">{benefits.map(([icon, title, detail]) => <div key={title}><span><FaIcon name={icon} /></span><p><b>{title}</b><small>{detail}</small></p></div>)}</div></div><div className="auth-vignette" aria-hidden="true"><div className="vignette-bag"><strong>M</strong></div><div className="vignette-box" /><div className="vignette-plant">✦</div></div><div className="auth-members"><span className="member-faces"><i>AA</i><i>SK</i><i>UF</i><i>+</i></span><p><b>Create your Mirwal account</b><small>Save products, compare options and track your orders.</small></p></div></aside><section className="auth-card">{isForgot ? <div className="auth-content"><h2>Reset your password</h2><p className="auth-subtitle">We will email you a link. It works once and expires in 30 minutes.</p><form onSubmit={sendReset}><label className="auth-field"><span>Email address</span><div><FaIcon name="envelope" /><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Enter your email address" /></div></label><button className="auth-submit" type="submit" disabled={submitting}>{submitting ? 'Sending…' : 'Email me a reset link'} <FaIcon name="arrow-right" /></button></form>{message && <p className="auth-message" role="status">{message}</p>}<p className="auth-note">Mirwal replies the same way whether or not that address has an account &mdash; otherwise this form would be a way to find out who shops here.</p><p className="auth-switch">Remembered it? <button type="button" onClick={() => { setMode('signin'); setMessage('') }}>Back to sign in</button></p></div> : <><div className="auth-tabs"><button className={!isSignUp ? 'active' : ''} type="button" onClick={() => switchMode('signin')}>Sign In</button><button className={isSignUp ? 'active' : ''} type="button" onClick={() => switchMode('signup')}>Create Account</button></div><div className="auth-content"><h2>{isSignUp ? 'Create your account' : 'Welcome back!'}</h2><p className="auth-subtitle">{isSignUp ? 'Join Mirwal and shop with confidence' : 'Sign in to continue to Mirwal'}</p><form onSubmit={submit}>{isSignUp && <label className="auth-field"><span>Full Name</span><div><FaIcon name="user" /><input required value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Enter your full name" /></div></label>}<label className="auth-field"><span>Email address</span><div><FaIcon name="envelope" /><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Enter your email address" /></div></label>{isSignUp && <label className="auth-field"><span>Phone Number <small>(optional)</small></span><div><FaIcon name="phone" /><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="03XXXXXXXXX" /></div></label>}<label className="auth-field"><span>Password {isSignUp && <small>(minimum 8 characters)</small>}</span><div><FaIcon name="lock" /><input required minLength={isSignUp ? 8 : 1} value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} placeholder="Enter your password" /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)}><FaIcon name={showPassword ? 'eye-slash' : 'eye'} /></button></div></label>{isSignUp && <label className="auth-field"><span>Confirm Password</span><div><FaIcon name="lock" /><input required minLength="8" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" placeholder="Confirm your password" /></div></label>}{!isSignUp && !twoFactorRequired && <div className="auth-options"><label><input type="checkbox" /> Remember me</label><button type="button" onClick={() => { setMode('forgot'); setMessage('') }}>Forgot Password?</button></div>}{twoFactorRequired && <div className="auth-2fa"><p className="auth-2fa-lead"><FaIcon name="shield-halved" /> <b>Two-factor authentication</b></p><p className="auth-2fa-note">Enter the six-digit code from your authenticator app. A recovery code works here too if you have lost your phone.</p><label className="auth-field"><span>Authentication code</span><div><FaIcon name="key" /><input required autoFocus value={totpCode} onChange={(event) => setTotpCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={20} placeholder="123456" /></div></label><button type="button" className="auth-2fa-back" onClick={() => { setTwoFactorRequired(false); setTotpCode(''); setPassword(''); setMessage('') }}>Use a different account</button></div>}<button className="auth-submit" type="submit" disabled={submitting}>{submitting ? 'Please wait…' : isSignUp ? 'Create Account' : twoFactorRequired ? 'Verify and sign in' : 'Sign In'} <FaIcon name="arrow-right" /></button></form>{message && <p className="auth-message" role="status">{message}</p>}<p className="auth-switch">{isSignUp ? 'Already have an account?' : "Don't have an account?"} <button type="button" onClick={() => switchMode(isSignUp ? 'signin' : 'signup')}>{isSignUp ? 'Sign In' : 'Create Account'}</button></p></div></>}</section></div></main>
}
