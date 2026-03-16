/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
  lang?: string
}

const i18n: Record<string, Record<string, string>> = {
  pt: {
    preview: 'Seu link de acesso à KGeN',
    heading: 'Seu link de acesso',
    body: 'Clique no botão abaixo para entrar na sua conta KGeN. Este link expira em breve.',
    button: 'ENTRAR',
    footer: 'Se você não solicitou este link, pode ignorar este email com segurança.',
  },
  es: {
    preview: 'Tu enlace de acceso a KGeN',
    heading: 'Tu enlace de acceso',
    body: 'Haz clic en el botón de abajo para ingresar a tu cuenta KGeN. Este enlace expira pronto.',
    button: 'INGRESAR',
    footer: 'Si no solicitaste este enlace, puedes ignorar este email con seguridad.',
  },
  en: {
    preview: 'Your KGeN login link',
    heading: 'Your login link',
    body: 'Click the button below to sign in to your KGeN account. This link expires shortly.',
    button: 'SIGN IN',
    footer: "If you didn't request this link, you can safely ignore this email.",
  },
}

function getLang(lang?: string): string {
  if (lang && i18n[lang]) return lang
  return 'pt'
}

export const MagicLinkEmail = ({
  siteName,
  confirmationUrl,
  lang,
}: MagicLinkEmailProps) => {
  const t = i18n[getLang(lang)]
  const htmlLang = getLang(lang)

  return (
    <Html lang={htmlLang} dir="ltr">
      <Head />
      <Preview>{t.preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Img
            src="https://wvsixcvsfndhoygbkzkj.supabase.co/storage/v1/object/public/email-assets/kgen-logo-green-v3.png"
            width="56"
            height="56"
            alt="KGeN"
            style={{ marginBottom: '24px', display: 'block', width: '56px', height: '56px', objectFit: 'contain' }}
          />
          <Heading style={h1}>{t.heading}</Heading>
          <Text style={text}>{t.body}</Text>
          <Button style={button} href={confirmationUrl}>
            {t.button}
          </Button>
          <Text style={footer}>{t.footer}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export default MagicLinkEmail

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
const button = {
  backgroundColor: '#8cff05',
  color: '#1f3338',
  fontSize: '14px',
  fontWeight: 'bold' as const,
  fontFamily: "'Space Mono', 'Courier New', monospace",
  borderRadius: '0px',
  padding: '14px 28px',
  textDecoration: 'none',
  textTransform: 'uppercase' as const,
  letterSpacing: '1px',
}
const footer = { fontSize: '12px', color: '#999999', margin: '32px 0 0' }
