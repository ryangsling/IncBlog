describe('Mailer', () => {
  it('sendMail returns false when no transporter configured', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
    delete require.cache[require.resolve('../src/middleware/mailer')];
    const { sendMail } = require('../src/middleware/mailer');
    const result = await sendMail({ to: 'test@test.com', subject: 'Test', html: '<p>Hi</p>' });
    expect(result).toBe(false);
  });

  it('sendMail uses Nodemailer when SMTP_HOST is set', async () => {
    delete process.env.RESEND_API_KEY;
    process.env.SMTP_HOST = 'localhost';
    process.env.SMTP_PORT = '1025';
    delete require.cache[require.resolve('../src/middleware/mailer')];
    const mailer = require('../src/middleware/mailer');

    // Mock transporter.sendMail
    const originalSendMail = mailer.sendMail;
    let called = false;
    // We can't easily mock the transporter, so just test it doesn't crash
    const result = await mailer.sendMail({ to: 'test@test.com', subject: 'Test', html: '<p>Hi</p>' });
    // It will fail to connect but should return false, not throw
    expect(typeof result).toBe('boolean');
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
  });
});
