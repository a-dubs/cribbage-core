# Debugging 400 Errors on Login

If you're getting 400 errors when trying to login, here are the most common causes and how to fix them:

## Common Causes

### 1. CORS (Cross-Origin Resource Sharing) Mismatch

**Problem**: The server's `WEB_APP_ORIGIN` doesn't match where the client is connecting from.

**Solution**:
- Check the server's `.env` file for `WEB_APP_ORIGIN`
- Make sure it matches the exact URL where the client is running (including port)
- You can now specify multiple origins separated by commas: `WEB_APP_ORIGIN=http://localhost:3000,http://localhost:3009,https://yourdomain.com`
- For development, you can leave `WEB_APP_ORIGIN` unset to allow all origins (not recommended for production)

**Example**:
```env
# Single origin
WEB_APP_ORIGIN=http://localhost:3000

# Multiple origins
WEB_APP_ORIGIN=http://localhost:3000,http://localhost:3009,https://yourdomain.com

# Wildcard subdomain (e.g., *.yourdomain.com matches app.yourdomain.com, api.yourdomain.com)
WEB_APP_ORIGIN=*.yourdomain.com
```

### 2. Authentication Token Mismatch

**Problem**: The `WEBSOCKET_AUTH_TOKEN` doesn't match between server and client.

**Solution**:
- Check server's `.env` file: `WEBSOCKET_AUTH_TOKEN=your-secret-token`
- Check client's `.env` file: `EXPO_PUBLIC_WEBSOCKET_AUTH_TOKEN=your-secret-token`
- They must be **exactly** the same
- Make sure there are no extra spaces or newlines

**Example**:
```env
# Server (.env in cribbage-core/)
WEBSOCKET_AUTH_TOKEN=my-secret-token-123

# Client (.env in cribbage-with-friends-app/)
EXPO_PUBLIC_WEBSOCKET_AUTH_TOKEN=my-secret-token-123
```

### 3. Server Not Accessible

**Problem**: The client can't reach the server (wrong URL, server not running, firewall, etc.)

**Solution**:
- Check the client's `EXPO_PUBLIC_API_URL` matches where the server is running
- If connecting from a different machine, use the server's IP address or domain name
- Make sure the server is actually running
- Check firewall settings if connecting across networks

**Example**:
```env
# Local development
EXPO_PUBLIC_API_URL=http://localhost:3002

# Different machine on same network
EXPO_PUBLIC_API_URL=http://192.168.1.100:3002

# Production/remote
EXPO_PUBLIC_API_URL=https://api.yourdomain.com
```

### 4. Server Not Running

**Problem**: The server isn't running or crashed.

**Solution**:
- Start the server: `cd cribbage-core && pnpm run build && pnpm run start-server`
- Check server logs for errors
- Make sure the port isn't already in use

## Debugging Steps

1. **Check Server Logs**:
   - Look for connection attempts in server console
   - Check for CORS errors
   - Check for authentication errors

2. **Check Client Logs**:
   - Open browser console (F12)
   - Look for WebSocket connection errors
   - Check the Network tab for failed requests

3. **Verify Environment Variables**:
   ```bash
   # On server
   cd cribbage-core
   cat .env | grep -E "WEB_APP_ORIGIN|WEBSOCKET_AUTH_TOKEN|PORT"
   
   # On client (check what's being used)
   # In browser console or app logs
   ```

4. **Test Server Directly**:
   ```bash
   # Test if server is reachable
   curl http://your-server-url:3002/ping
   # Should return "pong"
   ```

5. **Check Network Connectivity**:
   - If connecting from a different machine, make sure:
     - Both machines are on the same network (or server is publicly accessible)
     - Firewall allows connections on the server port
     - The server's IP/domain is correct

## Recent Improvements

The server now:
- Supports multiple CORS origins (comma-separated)
- Supports wildcard subdomains (`*.domain.com`)
- Provides better error logging for connection attempts
- Emits error events to clients for better debugging

## Quick Fix Checklist

- [ ] Server is running (`pnpm run start-server` in `cribbage-core/`)
- [ ] `WEB_APP_ORIGIN` in server `.env` matches client's origin (or is unset for dev)
- [ ] `WEBSOCKET_AUTH_TOKEN` matches between server and client `.env` files
- [ ] `EXPO_PUBLIC_API_URL` in client `.env` points to the correct server
- [ ] Server port is accessible (not blocked by firewall)
- [ ] No typos in environment variable names
- [ ] Rebuilt server after changing `.env` (`pnpm run build`)

## Still Having Issues?

1. Check server console for detailed connection logs
2. Check browser console for client-side errors
3. Verify all environment variables are set correctly
4. Try connecting from the same machine first to rule out network issues
5. Check if the server is behind a proxy/load balancer that might be blocking WebSocket connections


