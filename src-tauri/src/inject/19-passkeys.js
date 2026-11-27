  // Passkeys (#9). A webview may use them only in an app Apple has let act
  // as a web browser, so in fMess every passkey request is turned down at
  // once (NotAllowedError, measured in WebKit) and Facebook's sign-in, when
  // an account's two-factor method is a passkey, seemed stuck. fMess says why
  // and what to do instead. Passkey autofill (conditional mediation) asks
  // silently on the login page and is let be.
  const PASSKEY_NOTE = 'fmess-passkey-note';
  const passkeyStyle = document.createElement('style');
  passkeyStyle.textContent = `
    #${PASSKEY_NOTE} {
      position: fixed;
      left: 50%;
      bottom: 24px;
      z-index: 2147483646;
      display: flex;
      align-items: center;
      gap: 12px;
      width: max-content;
      max-width: min(520px, calc(100vw - 32px));
      box-sizing: border-box;
      padding: 12px 12px 12px 16px;
      border-radius: 10px;
      background: rgba(28, 30, 33, 0.96);
      color: #fff;
      font: 13px/18px system-ui, -apple-system, 'Segoe UI', sans-serif;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      transform: translateX(-50%);
    }
    #${PASSKEY_NOTE} > span { flex: 1 1 auto; }
    #${PASSKEY_NOTE} > button {
      flex: none;
      padding: 4px 12px;
      border: 0;
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.16);
      color: inherit;
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }
    #${PASSKEY_NOTE} > button:hover { background: rgba(255, 255, 255, 0.26); }
  `;
  withRoot((root) => root.append(passkeyStyle));
  const showPasskeyNote = () => {
    if (document.getElementById(PASSKEY_NOTE) || !document.body) return;
    const box = document.createElement('div');
    box.id = PASSKEY_NOTE;
    box.setAttribute('role', 'alert');
    const text = document.createElement('span');
    text.textContent = say(
      "Passkeys can't be used in fMess. Choose “Try another way” and sign in with a code from your authenticator app or a text message.",
      'fMess không dùng được passkey. Hãy chọn “Thử cách khác” và đăng nhập bằng mã từ ứng dụng xác thực hoặc tin nhắn SMS.',
    );
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.textContent = 'OK';
    ok.addEventListener('click', () => box.remove());
    box.append(text, ok);
    document.body.append(box);
  };
  const credentials = window.CredentialsContainer?.prototype;
  const nativeGet = credentials?.get;
  if (nativeGet) {
    credentials.get = function (options, ...rest) {
      const result = nativeGet.call(this, options, ...rest);
      if (options?.publicKey && options.mediation !== 'conditional') {
        result.catch((error) => error?.name === 'NotAllowedError' && showPasskeyNote());
      }
      return result;
    };
  }
