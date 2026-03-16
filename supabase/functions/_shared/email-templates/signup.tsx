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

interface SignupEmailProps {
  siteName: string
  siteUrl: string
  recipient: string
  confirmationUrl: string
  lang?: string
}

const i18n: Record<string, Record<string, string>> = {
  pt: {
    preview: 'Confirme seu cadastro na KGeN',
    heading: 'Confirme seu email',
    welcome: 'Bem-vindo à',
    community: '! Estamos felizes em ter você na nossa comunidade.',
    confirm: 'Confirme seu endereço de email (',
    confirmEnd: ') clicando no botão abaixo:',
    button: 'VERIFICAR EMAIL',
    footer: 'Se você não criou uma conta na KGeN, pode ignorar este email com segurança.',
  },
  es: {
    preview: 'Confirma tu registro en KGeN',
    heading: 'Confirma tu email',
    welcome: '¡Bienvenido a',
    community: '! Estamos felices de tenerte en nuestra comunidad.',
    confirm: 'Confirma tu dirección de email (',
    confirmEnd: ') haciendo clic en el botón de abajo:',
    button: 'VERIFICAR EMAIL',
    footer: 'Si no creaste una cuenta en KGeN, puedes ignorar este email con seguridad.',
  },
  en: {
    preview: 'Confirm your KGeN signup',
    heading: 'Confirm your email',
    welcome: 'Welcome to',
    community: '! We\'re happy to have you in our community.',
    confirm: 'Confirm your email address (',
    confirmEnd: ') by clicking the button below:',
    button: 'VERIFY EMAIL',
    footer: 'If you didn\'t create a KGeN account, you can safely ignore this email.',
  },
}

function getLang(lang?: string): string {
  if (lang && i18n[lang]) return lang
  return 'pt'
}

export const SignupEmail = ({
  siteName,
  siteUrl,
  recipient,
  confirmationUrl,
  lang,
}: SignupEmailProps) => {
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
          <Text style={text}>
            {t.welcome}{' '}
            <Link href={siteUrl} style={link}>
              <strong>KGeN</strong>
            </Link>
            {t.community}
          </Text>
          <Text style={text}>
            {t.confirm}
            <Link href={`mailto:${recipient}`} style={link}>
              {recipient}
            </Link>
            {t.confirmEnd}
          </Text>
          <Button style={button} href={confirmationUrl}>
            {t.button}
          </Button>
          <Text style={footer}>{t.footer}</Text>
        </Container>
      </Body>
    </Html>
  )
}

export default SignupEmail

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
const link = { color: '#1f3338', textDecoration: 'underline' }
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
