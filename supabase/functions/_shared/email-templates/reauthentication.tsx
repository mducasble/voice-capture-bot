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
}

export const ReauthenticationEmail = ({ token }: ReauthenticationEmailProps) => (
  <Html lang="pt" dir="ltr">
    <Head />
    <Preview>Seu código de verificação KGeN</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img
          src="https://qfxustvmwdyjduzpeafk.supabase.co/storage/v1/object/public/email-assets/kgen-logo-green.png"
          width="120"
          height="40"
          alt="KGeN"
          style={{ marginBottom: '24px' }}
        />
        <Heading style={h1}>Código de verificação</Heading>
        <Text style={text}>Use o código abaixo para confirmar sua identidade:</Text>
        <Text style={codeStyle}>{token}</Text>
        <Text style={footer}>
          Este código expira em breve. Se você não solicitou, pode ignorar este email com segurança.
        </Text>
      </Container>
    </Body>
  </Html>
)

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
