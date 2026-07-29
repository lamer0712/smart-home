# SmartThings AC Dashboard

Samsung SmartThings API로 에어컨을 제어하는 개인용 Next.js 대시보드입니다. 브라우저는 이 앱의 API Route만 호출하며, SmartThings OAuth 토큰과 앱 비밀번호는 서버 런타임에서만 다룹니다.

## 기능

- 전원 켜기/끄기
- 켜짐 예약
- 희망 온도 설정
- 운전 모드 변경
- 바람세기 변경
- 상태 조회
- 상태 변경 시 로딩 및 오류 표시
- 30초마다 자동 상태 갱신
- 모바일 대응 Tailwind UI

## 1. 설치

```bash
npm install
```

## 2. SmartThings OAuth 앱과 기기 ID 준비

1. SmartThings CLI를 설치하고 `smartthings devices`로 로그인합니다.
2. `smartthings apps:create`로 `OAuth-In App`을 생성합니다.
3. Redirect URI는 배포 URL 기준으로 아래 값을 등록합니다.

```text
https://smart-home-heremes.vercel.app/api/smartthings/callback
```

4. 권한은 최소 `r:devices:*`, `x:devices:*`, `r:rules:*`, `w:rules:*`를 선택합니다.
5. 생성 완료 시 표시되는 `OAuth Client Id`와 `OAuth Client Secret`을 저장합니다. Secret은 다시 표시되지 않습니다.
6. `smartthings devices` 또는 SmartThings API로 제어할 에어컨의 Device ID를 확인합니다.
7. 여러 폰/브라우저에서 같은 연결을 쓰려면 Vercel Marketplace에서 Upstash Redis를 프로젝트에 연결합니다.

## 3. 환경 변수 설정

`.env.example`을 참고해 `.env.local`을 만듭니다.

```bash
cp .env.example .env.local
```

필수 값:

```bash
SMARTTHINGS_DEVICE_ID=your_air_conditioner_device_id
SMARTTHINGS_LOCATION_ID=your_location_id
APP_PASSWORD=change_this_dashboard_password
SMART_HOME_API_KEY=change_this_server_to_server_api_key
SMARTTHINGS_CLIENT_ID=your_oauth_client_id
SMARTTHINGS_CLIENT_SECRET=your_oauth_client_secret
SMARTTHINGS_REDIRECT_URI=https://smart-home-heremes.vercel.app/api/smartthings/callback
KV_REST_API_URL=your_upstash_redis_rest_url
KV_REST_API_TOKEN=your_upstash_redis_rest_token
```

선택 값:

```bash
SMARTTHINGS_API_BASE_URL=https://api.smartthings.com/v1
SMARTTHINGS_REQUEST_TIMEOUT_MS=10000
SMARTTHINGS_TIME_ZONE_ID=Asia/Seoul
SMARTTHINGS_COMPONENT=main
SMARTTHINGS_TEMPERATURE_MIN=16
SMARTTHINGS_TEMPERATURE_MAX=30
SMARTTHINGS_TEMPERATURE_STEP=1
SMARTTHINGS_ALLOWED_MODES=cool,wind
SMARTTHINGS_ALLOWED_FAN_MODES=auto,medium,high,turbo
SMARTTHINGS_MODE_CAPABILITY=airConditionerMode
SMARTTHINGS_MODE_ATTRIBUTE=airConditionerMode
SMARTTHINGS_MODE_COMMAND=setAirConditionerMode
SMARTTHINGS_FAN_MODE_CAPABILITY=airConditionerFanMode
SMARTTHINGS_FAN_MODE_ATTRIBUTE=fanMode
SMARTTHINGS_FAN_MODE_COMMAND=setFanMode
SMARTTHINGS_TEMPERATURE_CAPABILITY=thermostatCoolingSetpoint
SMARTTHINGS_TEMPERATURE_ATTRIBUTE=coolingSetpoint
SMARTTHINGS_TEMPERATURE_COMMAND=setCoolingSetpoint
```

에어컨 모델에 따라 모드 capability와 attribute가 다를 수 있습니다. 예를 들어 일부 모델은 커스텀 capability를 쓰므로, 상태 조회 결과나 SmartThings CLI에서 확인한 capability ID를 `SMARTTHINGS_MODE_CAPABILITY`에 넣고 attribute 이름을 `SMARTTHINGS_MODE_ATTRIBUTE`에 넣으면 됩니다.

`SMARTTHINGS_TOKEN`은 예전 PAT 방식의 임시 fallback입니다. PAT는 장기 운영용이 아니므로 OAuth 연결 후에는 사용하지 않는 것을 권장합니다.

## 4. SmartThings 계정 연결

배포 후 앱 비밀번호로 로그인한 뒤 대시보드에서 `SmartThings 연결` 버튼을 누르거나 아래 경로로 이동합니다.

```text
/api/smartthings/connect
```

삼성 계정 승인 후 `/api/smartthings/callback`에서 access token과 refresh token을 받아 Upstash Redis에 저장합니다. 이후 다른 폰이나 브라우저에서도 앱 비밀번호만 입력하면 같은 서버 저장 토큰으로 SmartThings API를 호출합니다.

## 5. 로컬 실행

```bash
npm run dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

같은 Wi-Fi, 같은 LAN, 또는 Tailscale 네트워크의 다른 기기에서 접속하려면 다음처럼 실행합니다.

```bash
npm run dev:host
```

프로덕션 빌드로 안정적으로 띄우려면 다음 순서로 실행합니다.

```bash
npm run build
npm run start:host
```

그 다음 현재 PC의 LAN IP나 Tailscale IP로 접속합니다.

```text
http://YOUR_LAN_OR_TAILSCALE_IP:3000
```

빌드 검증:

```bash
npm run typecheck
npm run build
```

## 6. Vercel 배포

1. 이 프로젝트를 GitHub, GitLab, 또는 Bitbucket 저장소에 push합니다.
2. Vercel에서 `Add New Project`를 선택하고 저장소를 연결합니다.
3. Framework Preset은 `Next.js`로 둡니다.
4. Vercel Project Settings의 `Environment Variables`에 아래 값을 추가합니다.

```bash
SMARTTHINGS_DEVICE_ID=your_air_conditioner_device_id
SMARTTHINGS_LOCATION_ID=your_location_id
APP_PASSWORD=change_this_dashboard_password
SMART_HOME_API_KEY=change_this_server_to_server_api_key
SMARTTHINGS_CLIENT_ID=your_oauth_client_id
SMARTTHINGS_CLIENT_SECRET=your_oauth_client_secret
SMARTTHINGS_REDIRECT_URI=https://smart-home-heremes.vercel.app/api/smartthings/callback
KV_REST_API_URL=your_upstash_redis_rest_url
KV_REST_API_TOKEN=your_upstash_redis_rest_token
```

5. 필요한 경우 선택 환경 변수도 같은 화면에 추가합니다.
6. `Deploy`를 실행합니다.
7. 배포된 앱에 로그인한 뒤 `SmartThings 연결`을 한 번 수행합니다.

## 보안 메모

- SmartThings OAuth 값과 Upstash Redis 토큰에는 `NEXT_PUBLIC_` 접두사를 붙이지 마세요.
- 클라이언트 컴포넌트는 SmartThings API를 직접 호출하지 않고 `/api/ac/*`만 호출합니다.
- `APP_PASSWORD`를 설정하면 대시보드와 API Route가 앱 자체 비밀번호로 보호됩니다.
- `SMART_HOME_API_KEY`를 설정하면 `/api/ac/*`는 서버 간 호출에서 `Authorization: Bearer ...` 헤더로 비밀번호 로그인 없이 접근할 수 있습니다.
- Vercel의 `Deployment Protection`을 끄더라도 앱 비밀번호는 유지됩니다.
- `.env`, `.env.local`, `.vercel`은 `.gitignore`에 포함되어 있습니다.

## API Routes

다른 프로젝트에서 `/api/ac/*`를 호출할 때는 아래처럼 API 키를 보냅니다.

```bash
curl https://smart-home-heremes.vercel.app/api/ac/status \
  -H "Authorization: Bearer $SMART_HOME_API_KEY"
```

대체 헤더로 `X-Smart-Home-Api-Key: $SMART_HOME_API_KEY`도 사용할 수 있습니다.

## ChatGPT Custom GPT Action

ChatGPT에서 자연어로 에어컨을 제어하려면 Custom GPT의 `Actions`에 `openapi.yaml`을 등록합니다.

1. ChatGPT에서 `Explore GPTs` → `Create`를 엽니다.
2. `Configure` → `Actions` → `Create new action`을 선택합니다.
3. Authentication은 `API Key`를 선택하고 `Bearer` 방식으로 `SMART_HOME_API_KEY` 값을 입력합니다.
4. Schema 영역에 이 저장소의 `openapi.yaml` 내용을 붙여넣습니다.
5. 테스트 창에서 `에어컨 상태 알려줘`, `26도로 냉방 켜줘`처럼 호출합니다.

### `GET /api/ac/status`

에어컨 상태와 UI 제어 범위를 반환합니다.

### `POST /api/ac/power`

```json
{ "power": "on" }
```

또는:

```json
{ "power": "off" }
```

`off` 요청은 운전 모드를 송풍으로 바꾸고, 1시간 뒤 전원을 끄는 숨김 SmartThings Rule을 생성합니다. 이 숨김 Rule은 예약 목록에 표시되지 않습니다.

### `POST /api/ac/temperature`

```json
{ "temperature": 24 }
```

### `POST /api/ac/climate`

냉방 온도 적용:

```json
{ "mode": "cool", "temperature": 24, "fanMode": "auto" }
```

송풍 전환:

```json
{ "mode": "wind", "fanMode": "medium" }
```

`fanMode`는 선택 값이며, 함께 보내면 냉방/송풍 전환과 바람세기를 한 번에 적용합니다.

### `POST /api/ac/mode`

```json
{ "mode": "cool" }
```

### `POST /api/ac/fan-mode`

```json
{ "fanMode": "auto" }
```

기본 지원값은 `auto`, `medium`, `high`, `turbo`입니다. 모델에 따라 다르면 `SMARTTHINGS_ALLOWED_FAN_MODES`를 수정하세요.

### `GET /api/ac/schedules`

전원 예약 목록을 반환합니다. 예전 버전에서 만든 전원 꺼짐 항목이 남아 있으면 함께 반환되어 취소할 수 있습니다.

### `POST /api/ac/schedules`

켜짐 예약은 냉방 모드로 고정되며 `coolingSetpoint`로 희망 온도를 지정합니다.

```json
{ "power": "on", "runAt": "2026-07-27T23:30:00.000Z", "coolingSetpoint": 24 }
```

`power`는 `on`입니다. `runAt`은 현재보다 이후의 ISO 날짜 문자열이어야 합니다.

### `DELETE /api/ac/schedules/:id`

대기 중인 예약이나 예전 버전에서 만든 전원 꺼짐 항목을 취소합니다.

### `GET /api/smartthings/connect`

SmartThings OAuth 승인 화면으로 이동합니다. 앱 비밀번호 로그인 후 호출해야 합니다.

### `GET /api/smartthings/callback`

SmartThings OAuth 승인 후 authorization code를 받아 access token과 refresh token으로 교환하고 Upstash Redis에 저장합니다.

## 예약 동작

예약은 SmartThings 공식 Rules API로 SmartThings Cloud에 등록됩니다. 이 앱이 만든 Rule만 `SmartThings AC Reservation` 이름 prefix로 필터링해 보여줍니다. 로컬 서버가 꺼져 있어도 SmartThings Cloud에 등록된 예약 자체는 남아 있습니다.
