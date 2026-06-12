import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchWhatsappMessage } from './whatsapp.js';

test('dispatchWhatsappMessage should fall back to WhatsApp link when Menuia is unavailable', async () => {
  const settings = {
    id: 'settings-1',
    companyName: 'Loja',
    logoUrl: null,
    whatsappNumber: '+55 (75) 99999-9999',
    deliveryPhoneNumber: null,
    deliveryFee: 5 as any,
    openTime: '18:00',
    closeTime: '23:59',
    autoMessage: '',
    pixKey: null,
    pixQrCodeUrl: null,
    darkModeEnabled: true,
    menuiaApiKey: 'invalid-key',
    menuiaStoreId: 'invalid-store',
    menuiaEnabled: true,
    updatedAt: new Date(),
    createdAt: new Date()
  } as any;

  const result = await dispatchWhatsappMessage(settings, '75999999999', 'Mensagem de teste', '75999999999');

  assert.equal(result.ok, true);
  assert.equal(result.channel, 'WHATSAPP_LINK');
  assert.match(result.whatsappUrl ?? '', /wa\.me\/75999999999/);
});
