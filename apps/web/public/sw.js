self.addEventListener('push', (event) => {
  let payload = {};

  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      title: 'Blabber',
      body: 'You have a new message',
      data: {},
    };
  }

  const title = payload.title || 'Blabber';
  const options = {
    body: payload.body || 'You have a new message',
    icon: '/vite.svg',
    badge: '/vite.svg',
    tag: payload.data?.messageId || payload.data?.chatId || undefined,
    renotify: false,
    data: {
      chatId: payload.data?.chatId,
      route: payload.data?.route || (payload.data?.chatId ? `/chats/${payload.data.chatId}` : '/chats'),
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const route = event.notification.data?.route || '/chats';
  const targetUrl = new URL(route, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      for (const client of clientList) {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client) {
            return client.navigate(targetUrl);
          }
          return undefined;
        }
      }

      return self.clients.openWindow(targetUrl);
    })
  );
});
