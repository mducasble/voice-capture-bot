/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface ReauthenticationEmailProps {
  token: string
  lang?: string
}

const i18n: Record<string, Record<string, string>> = {
  pt: {
    preview: 'Seu código de verificação KGeN',
    heading: 'Código de verificação',
    body: 'Use o código abaixo para confirmar sua identidade:',
    footer: 'Este código expira em breve. Se você não solicitou, pode ignorar este email com segurança.',
  },
  es: {
    preview: 'Tu código de verificación KGeN',
    heading: 'Código de verificación',
    body: 'Usa el código de abajo para confirmar tu identidad:',
    footer: 'Este código expira pronto. Si no lo solicitaste, puedes ignorar este email con seguridad.',
  },
  en: {
    preview: 'Your KGeN verification code',
    heading: 'Verification code',
    body: 'Use the code below to confirm your identity:',
    footer: "This code expires shortly. If you didn't request it, you can safely ignore this email.",
  },
}

function getLang(lang?: string): string {
  if (lang && i18n[lang]) return lang
  return 'pt'
}

export const ReauthenticationEmail = ({ token, lang }: ReauthenticationEmailProps) => {
  const t = i18n[getLang(lang)]
  const htmlLang = getLang(lang)

  return (
    <Html lang={htmlLang} dir="ltr">
      <Head />
      <Preview>{t.preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Img
            src="https://qfxustvmwdyjduzpeafk.supabase.co/storage/v1/object/public/email-assets/kgen-logo-green.png"
            width="120"
            height="40"
            alt="KGeN"
            style={{ marginBottom: '24px' }}
          />
          <Heading style={h1}>{t.heading}</Heading>
          <Text style={text}>{t.body}</Text>
          <Text style={codeStyle}>{token}</Text>
          <Text style={footer}>{t.footer}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export default ReauthenticationEmail

const main = { backgroundColor: '#ffffff', fontFamily: "'Space Mono', 'Courier New', monospace" }
const container = { padding: '32px 28px', maxWidth: '480px', margin: '0 auto' }
const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#1f3338',
  margin: '0 0 20px',
  textTransform: 'uppercase' as const,
  letterSpacing: '1px',
}
const text = {
  fontSize: '14px',
  color: '#4a5568',
  lineHeight: '1.6',
  margin: '0 0 24px',
}
const codeStyle = {
  fontFamily: "'Space Mono', 'Courier New', monospace",
  fontSize: '28px',
  fontWeight: 'bold' as const,
  color: '#1f3338',
  backgroundColor: '#f0ffd6',
  padding: '12px 20px',
  margin: '0 0 30px',
  display: 'inline-block' as const,
  letterSpacing: '4px',
}
const footer = { fontSize: '12px', color: '#999999', margin: '32px 0 0' }
