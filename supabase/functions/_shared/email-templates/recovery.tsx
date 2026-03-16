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

interface RecoveryEmailProps {
  siteName: string
  confirmationUrl: string
  lang?: string
}

const i18n: Record<string, Record<string, string>> = {
  pt: {
    preview: 'Redefinir sua senha na KGeN',
    heading: 'Redefinir senha',
    body: 'Recebemos um pedido para redefinir a senha da sua conta KGeN. Clique no botão abaixo para escolher uma nova senha.',
    button: 'REDEFINIR SENHA',
    footer: 'Se você não solicitou a redefinição de senha, pode ignorar este email. Sua senha não será alterada.',
  },
  es: {
    preview: 'Restablecer tu contraseña en KGeN',
    heading: 'Restablecer contraseña',
    body: 'Recibimos una solicitud para restablecer la contraseña de tu cuenta KGeN. Haz clic en el botón de abajo para elegir una nueva contraseña.',
    button: 'RESTABLECER CONTRASEÑA',
    footer: 'Si no solicitaste el restablecimiento de contraseña, puedes ignorar este email. Tu contraseña no será modificada.',
  },
  en: {
    preview: 'Reset your KGeN password',
    heading: 'Reset password',
    body: 'We received a request to reset your KGeN account password. Click the button below to choose a new password.',
    button: 'RESET PASSWORD',
    footer: "If you didn't request a password reset, you can safely ignore this email. Your password won't be changed.",
  },
}

function getLang(lang?: string): string {
  if (lang && i18n[lang]) return lang
  return 'pt'
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
  lang,
}: RecoveryEmailProps) => {
  const t = i18n[getLang(lang)]
  const htmlLang = getLang(lang)

  return (
    <Html lang={htmlLang} dir="ltr">
      <Head />
      <Preview>{t.preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Img
            src="https://wvsixcvsfndhoygbkzkj.supabase.co/storage/v1/object/public/email-assets/kgen-logo-green.png"
            width="120"
            alt="KGeN"
            style={{ marginBottom: '24px' }}
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

export default RecoveryEmail

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
