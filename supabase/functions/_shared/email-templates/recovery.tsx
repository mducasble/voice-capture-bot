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
}

export const RecoveryEmail = ({
  siteName,
  confirmationUrl,
}: RecoveryEmailProps) => (
  <Html lang="pt" dir="ltr">
    <Head />
    <Preview>Redefinir sua senha na KGeN</Preview>
    <Body style={main}>
      <Container style={container}>
        <Img
          src="https://qfxustvmwdyjduzpeafk.supabase.co/storage/v1/object/public/email-assets/kgen-logo-green.png"
          width="120"
          height="40"
          alt="KGeN"
          style={{ marginBottom: '24px' }}
        />
        <Heading style={h1}>Redefinir senha</Heading>
        <Text style={text}>
          Recebemos um pedido para redefinir a senha da sua conta KGeN. Clique no botão abaixo para escolher uma nova senha.
        </Text>
        <Button style={button} href={confirmationUrl}>
          REDEFINIR SENHA
        </Button>
        <Text style={footer}>
          Se você não solicitou a redefinição de senha, pode ignorar este email. Sua senha não será alterada.
        </Text>
      </Container>
    </Body>
  </Html>
)

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
