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
  Link,
  Preview,
  Text,
} from 'npm:@react-email/components@0.0.22'

interface EmailChangeEmailProps {
  siteName: string
  email: string
  newEmail: string
  confirmationUrl: string
  lang?: string
}

const i18n: Record<string, Record<string, string>> = {
  pt: {
    preview: 'Confirme a alteração de email na KGeN',
    heading: 'Alteração de email',
    body1: 'Você solicitou a alteração do seu email na KGeN de',
    body2: 'para',
    body3: 'Clique no botão abaixo para confirmar esta alteração:',
    button: 'CONFIRMAR ALTERAÇÃO',
    footer: 'Se você não solicitou esta alteração, proteja sua conta imediatamente.',
  },
  es: {
    preview: 'Confirma el cambio de email en KGeN',
    heading: 'Cambio de email',
    body1: 'Solicitaste el cambio de tu email en KGeN de',
    body2: 'a',
    body3: 'Haz clic en el botón de abajo para confirmar este cambio:',
    button: 'CONFIRMAR CAMBIO',
    footer: 'Si no solicitaste este cambio, protege tu cuenta de inmediato.',
  },
  en: {
    preview: 'Confirm your KGeN email change',
    heading: 'Email change',
    body1: 'You requested to change your KGeN email from',
    body2: 'to',
    body3: 'Click the button below to confirm this change:',
    button: 'CONFIRM CHANGE',
    footer: "If you didn't request this change, please secure your account immediately.",
  },
}

function getLang(lang?: string): string {
  if (lang && i18n[lang]) return lang
  return 'pt'
}

export const EmailChangeEmail = ({
  siteName,
  email,
  newEmail,
  confirmationUrl,
  lang,
}: EmailChangeEmailProps) => {
  const t = i18n[getLang(lang)]
  const htmlLang = getLang(lang)

  return (
    <Html lang={htmlLang} dir="ltr">
      <Head />
      <Preview>{t.preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Img
            src="https://wvsixcvsfndhoygbkzkj.supabase.co/storage/v1/object/public/email-assets/kgen-logo-green-v2.png"
            width="120"
            height="120"
            alt="KGeN"
            style={{ marginBottom: '24px', display: 'block' }}
          />
          <Heading style={h1}>{t.heading}</Heading>
          <Text style={text}>
            {t.body1}{' '}
            <Link href={`mailto:${email}`} style={linkStyle}>
              {email}
            </Link>{' '}
            {t.body2}{' '}
            <Link href={`mailto:${newEmail}`} style={linkStyle}>
              {newEmail}
            </Link>
            .
          </Text>
          <Text style={text}>{t.body3}</Text>
          <Button style={button} href={confirmationUrl}>
            {t.button}
          </Button>
          <Text style={footer}>{t.footer}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export default EmailChangeEmail

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
const linkStyle = { color: '#1f3338', textDecoration: 'underline' }
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
