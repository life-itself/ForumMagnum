import { useForumType } from '@/components/hooks/useForumType';
import React, { useCallback, useRef, useState } from 'react';
import { reCaptchaSiteKey } from '../../lib/instanceSettings';
import { useMutation } from "@apollo/client/react";
import { gql } from '@/lib/generated/gql-codegen';
import { getUserABTestKey } from '../../lib/abTestImpl';
import { useClientId } from '../hooks/useClientId.ts';
import { useLocation } from '../../lib/routeUtil';
import ContentStyles from "../common/ContentStyles";
import ReCaptcha from "../common/ReCaptcha";
import SignupSubscribeToCurated from "./SignupSubscribeToCurated";
import DeferRender from '../common/DeferRender';
import { ErrorLike } from '@apollo/client';
import { defineStyles, useStyles } from '../hooks/useStyles.tsx';
import { sanitizeLoginReturnTo } from '@/lib/auth/loginNotices';

const styles = defineStyles('LoginForm', (theme: ThemeType) => ({
  root: {
    wordBreak: "normal",
    padding: 16,
    marginTop: 0,
    marginBottom: 0,
    width: 252
  }, 
  input: {
    font: 'inherit',
    color: 'inherit',
    display: 'block',
    fontSize: '1.2rem',
    marginBottom: 8,
    padding: 8,
    backgroundColor: theme.palette.panelBackground.darken03,
    width: '100%'
  },
  submit: {
    font: 'inherit',
    color: 'inherit',
    background: theme.palette.grey[200],
    display: 'block',
    textTransform: 'uppercase',
    width: '100%',
    height: 32,
    marginTop: 16,
    cursor: 'pointer',
    fontSize: '1rem',
    '&:hover': {
      background: theme.palette.grey[300],
    },
    '&:active': {
      background: theme.palette.grey[400],
    },
    '&:disabled': {
      cursor: 'default',
      opacity: 0.7,
    },
  }, 
  error: {
    padding: 8,
    color: theme.palette.error.main 
  },
  confirmation: {
    padding: 8,
    color: theme.palette.text.normal,
  },
  options: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '1rem',
    marginTop: 4,
    padding: 4
  },
  oAuthBlock: {
    display: 'flex',
    justifyContent: 'space-between',
    '&.ea-forum': {
      maxWidth: 400,
      justifyContent: 'space-around',
      padding: '8px 20px',
    }
  },
  oAuthComment: {
    textAlign: 'center',
    fontSize: '0.8em',
    margin: 10
  },
  oAuthLink: {
    color: `${theme.palette.text.slightlyDim2} !important`,
    fontSize: '0.9em',
    padding: 6,
    textTransform: 'uppercase'
  },
  primaryBtn: {
    background: theme.palette.primary.main,
    color: `${theme.palette.buttons.primaryDarkText} !important`,
    fontSize: '0.9em',
    padding: '6px 12px',
    textTransform: 'uppercase',
    borderRadius: 4
  },
  toggle: {
    cursor: 'pointer',
    '&:hover': {
      color: theme.palette.link.dim,
    }
  }
}))

type possibleActions = "login" | "signup" | "pwReset"

const currentActionToButtonText: Record<possibleActions, string> = {
  login: "Log In",
  signup: "Sign Up",
  pwReset: "Request Password Reset"
}

const LoginForm = ({ startingState = "login", returnTo, autoFocus = false }: {
  startingState?: possibleActions,
  returnTo?: string,
  /** Only enable when the form is opened by a user interaction. */
  autoFocus?: boolean,
}) => {
  const { isAF } = useForumType();
  const classes = useStyles(styles);
  const hasSubscribeToCuratedCheckbox = !isAF;

  const { pathname } = useLocation()
  const reCaptchaToken = useRef<string|null>(null);
  const [username, setUsername] = useState<string>("")
  const [password, setPassword] = useState<string>("")
  const [email, setEmail] = useState<string>("")
  const [currentAction, setCurrentAction] = useState<possibleActions>(startingState)
  const [subscribeToCurated, setSubscribeToCurated] = useState<boolean>(hasSubscribeToCuratedCheckbox)

  const [loginMutation] = useMutation(gql(`
    mutation login($username: String, $password: String) {
      login(username: $username, password: $password) {
        token
      }
    }
  `), {
    errorPolicy: 'all',
    // The server sets the login token as an HttpOnly cookie, which only works
    // through the non-streaming endpoint
    context: { nonStreaming: true },
  })

  const [signupMutation] = useMutation(gql(`
    mutation signup($email: String, $username: String, $password: String, $subscribeToCurated: Boolean, $reCaptchaToken: String, $abTestKey: String) {
      signup(email: $email, username: $username, password: $password, subscribeToCurated: $subscribeToCurated, reCaptchaToken: $reCaptchaToken, abTestKey: $abTestKey) {
        token
      }
    }
  `), {
    errorPolicy: 'all',
    context: { nonStreaming: true },
  })

  const [pwResetMutation] = useMutation(gql(`
    mutation resetPassword($email: String) {
      resetPassword(email: $email)
    }
  `), { errorPolicy: 'all' })

  const [displayedError, setDisplayedError] = useState<string|null>(null);
  const [resetConfirmation, setResetConfirmation] = useState<string|null>(null);
  const [submitting, setSubmitting] = useState(false);
  const clientId = useClientId();

  const showError = (error: ErrorLike) => {
    setDisplayedError(error.message);
  }
  
  const loginSuccess = useCallback(() => {
    if (returnTo) {
      window.location.href = sanitizeLoginReturnTo(returnTo);
    } else if (pathname.startsWith("/resetPassword")) {
      // Reloading would show the used reset link again
      window.location.href = "/";
    } else {
      location.reload()
    }
  }, [returnTo, pathname])

  const switchAction = (action: possibleActions) => {
    setCurrentAction(action);
    setDisplayedError(null);
    setResetConfirmation(null);
  }

  const submitFunction = async (e: AnyBecauseTodo) => {
    e.preventDefault();
    setSubmitting(true);
    setDisplayedError(null);
    setResetConfirmation(null);
    try {
      await submitAction();
    } finally {
      setSubmitting(false);
    }
  }

  const submitAction = async () => {
    const signupAbTestKey = getUserABTestKey({clientId});

    if (currentAction === 'login') {
      const { data, error } = await loginMutation({
        variables: { username, password }
      })
      if (error) {
        showError(error);
      }
      if (data?.login?.token) {
        loginSuccess();
      }
    } else if (currentAction === 'signup') {
      const { data, error } = await signupMutation({
        variables: {
          email, username, password,
          reCaptchaToken: reCaptchaToken.current,
          abTestKey: signupAbTestKey,
          subscribeToCurated
        }
      })
      if (error) {
        showError(error);
      }
      if (data?.signup?.token) {
        loginSuccess();
      }
    } else if (currentAction === 'pwReset') {
      const { data, error } = await pwResetMutation({
        variables: { email }
      })
      if (error) {
        showError(error);
      }
      if (data?.resetPassword) {
        setResetConfirmation(data.resetPassword)
      }
    }
  }

  const oauthReturnTo = encodeURIComponent(sanitizeLoginReturnTo(returnTo ?? pathname));

  return <ContentStyles contentType="commentExceptPointerEvents">
    {reCaptchaSiteKey && <DeferRender ssr={false}>
      <ReCaptcha verifyCallback={(token) => reCaptchaToken.current = token} action="login/signup"/>
    </DeferRender>}
    <form className={classes.root} onSubmit={submitFunction}>
      {["signup", "pwReset"].includes(currentAction) && <input value={email} type="text" name="email" placeholder="email" className={classes.input} onChange={event => setEmail(event.target.value)} />}
      {["signup", "login"].includes(currentAction) && <>
        <input
          value={username} type="text" name="username"
          autoComplete="username"
          autoFocus={autoFocus}
          placeholder={currentAction === "signup" ? "username" : "username or email"}
          className={classes.input}
          onChange={event => setUsername(event.target.value)}
        />
        <input
          value={password} type="password" name="password"
          autoComplete={currentAction==="signup" ? "new-password" : "current-password"}
          placeholder={(currentAction==="signup") ? "create password" : "password"}
          className={classes.input}
          onChange={event => setPassword(event.target.value)}
        />
      </>}
      <input
        type="submit"
        className={classes.submit}
        disabled={submitting}
        value={submitting && currentAction === "pwReset" ? "Sending…" : currentActionToButtonText[currentAction]}
      />
      {resetConfirmation && <div className={classes.confirmation}>{resetConfirmation}</div>}
      
      {currentAction === "signup" && hasSubscribeToCuratedCheckbox &&
        <SignupSubscribeToCurated defaultValue={subscribeToCurated} onChange={(checked: boolean) => setSubscribeToCurated(checked)} />
      }
      <div className={classes.options}>
        {currentAction !== "login" && <span className={classes.toggle} onClick={() => switchAction("login")}> Log In </span>}
        {currentAction !== "signup" && <span className={classes.toggle} onClick={() => switchAction("signup")}> Sign Up </span>}
        {currentAction !== "pwReset" && <span className={classes.toggle} onClick={() => switchAction("pwReset")}> Reset Password </span>}
      </div>
      <>
        <div className={classes.oAuthComment}>...or continue with</div>
        <div className={classes.oAuthBlock}>
          <a className={classes.oAuthLink} href={`/auth/google?returnTo=${oauthReturnTo}`}>GOOGLE</a>
          <a className={classes.oAuthLink} href={`/auth/github?returnTo=${oauthReturnTo}`}>GITHUB</a>
        </div>
      </>
      {displayedError && <div className={classes.error}>{displayedError}</div>}
    </form>
  </ContentStyles>;
}

export default LoginForm;

