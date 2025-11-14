# Reverse Proxy Setup for Socket.IO

If your Socket.IO server is behind a reverse proxy (nginx, Apache, load balancer, etc.), you need special configuration to handle WebSocket connections and long-polling properly.

## The Problem

You may see errors like:
- `400 Bad Request` on Socket.IO polling requests
- `WebSocket connection failed: WebSocket is closed before the connection is established`
- Initial connection succeeds but subsequent requests fail

This happens because reverse proxies need special configuration for:
1. WebSocket upgrade requests
2. Socket.IO's long-polling fallback
3. Sticky sessions
4. Proper header forwarding

## Solution: Configure Your Reverse Proxy

### nginx Configuration

If using nginx, add this to your server configuration:

```nginx
# API/WebSocket server proxy (Port 3002)
server {
    listen 80;
    listen 443 ssl;
    server_name api.yourdomain.com;

    # SSL configuration (if using HTTPS)
    # ssl_certificate /path/to/cert.pem;
    # ssl_certificate_key /path/to/key.pem;

    # Proxy to Socket.IO server
    location / {
        proxy_pass http://localhost:3002;
        
        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        # Forward headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # Timeouts for long-polling
        proxy_connect_timeout 7d;
        proxy_send_timeout 7d;
        proxy_read_timeout 7d;
        
        # Buffering
        proxy_buffering off;
        
        # Important for Socket.IO
        proxy_set_header X-Forwarded-Host $server_name;
    }
}

# Frontend server (Port 3009)
server {
    listen 80;
    listen 443 ssl;
    server_name app.yourdomain.com;

    # SSL configuration (if using HTTPS)
    # ssl_certificate /path/to/cert.pem;
    # ssl_certificate_key /path/to/key.pem;

    # CORS headers for cross-origin requests to API
    add_header 'Access-Control-Allow-Origin' 'https://api.yourdomain.com' always;
    add_header 'Access-Control-Allow-Credentials' 'true' always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'Origin, X-Requested-With, Content-Type, Accept, Authorization' always;

    # Proxy to frontend server
    location / {
        proxy_pass http://localhost:3009;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Apache Configuration

If using Apache, add this to your VirtualHost:

```apache
<VirtualHost *:80>
    ServerName api.yourdomain.com
    
    # Enable proxy modules (make sure these are enabled)
    # a2enmod proxy proxy_http proxy_wstunnel
    
    # Proxy WebSocket and HTTP
    ProxyPreserveHost On
    ProxyPass / http://localhost:3002/
    ProxyPassReverse / http://localhost:3002/
    
    # WebSocket support
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/?(.*) "ws://localhost:3002/$1" [P,L]
    
    # Headers
    RequestHeader set X-Forwarded-Proto "http"
    RequestHeader set X-Forwarded-Port "80"
</VirtualHost>
```

### Cloud Load Balancers

#### AWS ALB (Application Load Balancer)

1. Enable sticky sessions (required for Socket.IO polling):
   - Target Group → Attributes → Enable stickiness
   - Duration: 86400 seconds (1 day)

2. Health check settings:
   - Path: `/ping`
   - Port: 3002
   - Protocol: HTTP

3. Listener rules:
   - Protocol: HTTP/HTTPS
   - Forward to target group

#### Google Cloud Load Balancer

1. Backend service configuration:
   - Session affinity: CLIENT_IP
   - Timeout: 3600 seconds

2. Health check:
   - Request path: `/ping`
   - Port: 3002

#### Azure Load Balancer

1. Configure session persistence:
   - Session persistence: Client IP
   - Idle timeout: maximum value

## Environment Variables

Make sure your server environment variables are set correctly:

```env
# Server (.env in cribbage-core/)
PORT=3002
WEB_APP_ORIGIN=https://app.yourdomain.com
WEBSOCKET_AUTH_TOKEN=your-secret-token-here
```

```env
# Client (.env in cribbage-with-friends-app/)
EXPO_PUBLIC_API_URL=https://api.yourdomain.com
EXPO_PUBLIC_WEBSOCKET_AUTH_TOKEN=your-secret-token-here
```

## Testing Your Configuration

### 1. Test Basic Connectivity

```bash
# Test HTTP endpoint
curl https://api.yourdomain.com/ping
# Should return: pong

# Test WebSocket upgrade (with wscat)
npm install -g wscat
wscat -c wss://api.yourdomain.com/socket.io/?EIO=4&transport=websocket
```

### 2. Check Headers

```bash
# Verify headers are being forwarded
curl -I https://api.yourdomain.com/ping
```

### 3. Monitor Server Logs

Look for these messages in your server logs:
- `[Handshake] Request from origin: https://app.yourdomain.com`
- `[Connection] Authenticated socket connection: ...`

If you see:
- No handshake logs: Proxy isn't forwarding requests
- Handshake but no connection: Auth is failing or connection is timing out

## Common Issues

### Issue: 400 Bad Request on Polling

**Cause**: Proxy is not configured for long-polling or sticky sessions.

**Solution**:
- Enable sticky sessions on your load balancer
- Increase proxy timeouts
- Make sure `proxy_buffering off` in nginx

### Issue: WebSocket Upgrade Failed

**Cause**: Proxy doesn't support WebSocket upgrade.

**Solution**:
- Add WebSocket upgrade headers in nginx/Apache config
- Check firewall allows WebSocket protocol

### Issue: CORS Errors

**Cause**: `WEB_APP_ORIGIN` doesn't match client origin.

**Solution**:
- Set `WEB_APP_ORIGIN=https://app.yourdomain.com` on server
- Or use comma-separated list for multiple origins
- Server now automatically supports both HTTP and HTTPS versions

### Issue: Connection Succeeds Then Drops

**Cause**: Proxy timeout is too short.

**Solution**:
- Increase proxy timeouts (see nginx config above)
- Server now has `pingTimeout: 60000ms` and `pingInterval: 25000ms`

## Quick Checklist

- [ ] Reverse proxy configured with WebSocket support
- [ ] Sticky sessions enabled (for load balancers)
- [ ] Proxy timeouts increased (7 days recommended)
- [ ] Headers properly forwarded (X-Forwarded-For, etc.)
- [ ] CORS configured correctly
- [ ] SSL certificates valid (if using HTTPS)
- [ ] Firewall allows WebSocket connections
- [ ] `WEB_APP_ORIGIN` matches client origin
- [ ] Auth tokens match between client and server

## Docker Compose Example

If using Docker Compose with nginx proxy:

```yaml
version: '3.8'
services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - api
      - frontend

  api:
    build: ./cribbage-core
    environment:
      - PORT=3002
      - WEB_APP_ORIGIN=https://app.yourdomain.com
      - WEBSOCKET_AUTH_TOKEN=${WEBSOCKET_AUTH_TOKEN}
    expose:
      - 3002

  frontend:
    build: ./cribbage-with-friends-app
    expose:
      - 3009
```

## Still Having Issues?

1. Check server logs for connection attempts
2. Check browser console for detailed error messages
3. Use browser DevTools Network tab to inspect Socket.IO requests
4. Verify environment variables are set correctly
5. Test direct connection (bypass proxy) to isolate the issue
6. Check if firewall/security groups are blocking WebSocket connections

