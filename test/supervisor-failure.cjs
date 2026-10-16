console.error("Falha sintética do backend, sem acesso ao WhatsApp");
process.exit(Number(process.env.TEST_FAILURE_CODE));
