document.getElementById('run').addEventListener('click', () => {
  const sample = {
    mapping: {
      old1: {
        message: {
          create_time: 1735000000,
          content: { parts: ['very old message content ...'] }
        }
      },
      recent1: {
        message: {
          create_time: 1735001000,
          content: { parts: ['recent message that should stay visible'] }
        }
      }
    }
  };

  document.getElementById('original').textContent = JSON.stringify(sample, null, 2);

  const copy = JSON.parse(JSON.stringify(sample));
  const newest = 1735001000;
  const limit = newest - 5 * 60;

  for (const key in copy.mapping) {
    const node = copy.mapping[key];
    const t = node?.message?.create_time;
    if (typeof t === 'number' && t < limit) {
      node.message.content.parts = ['[placeholder old message]'];
    }
  }

  document.getElementById('optimized').textContent = JSON.stringify(copy, null, 2);
});
