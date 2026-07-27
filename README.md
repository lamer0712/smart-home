# SmartThings AC Dashboard

Samsung SmartThings API로 에어컨을 제어하는 개인용 Next.js 대시보드입니다. 브라우저는 이 앱의 API Route만 호출하며, `SMARTTHINGS_TOKEN`은 서버 런타임에서만 읽습니다.

## 기능

- 전원 켜기/끄기
- 켜짐/꺼짐 예약
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

## 2. SmartThings 토큰과 기기 ID 준비

1. SmartThings Personal Access Token 페이지에서 개인 토큰을 생성합니다.
2. 토큰 권한은 최소한 기기 조회와 기기 제어 권한을 포함해야 합니다.
3. SmartThings API, CLI, 또는 SmartThings 개발자 도구로 제어할 에어컨의 Device ID를 확인합니다.

## 3. 환경 변수 설정

`.env.example`을 참고해 `.env.local`을 만듭니다.

```bash
cp .env.example .env.local
```

필수 값:

```bash
SMARTTHINGS_TOKEN=your_personal_access_token
SMARTTHINGS_DEVICE_ID=your_air_conditioner_device_id
SMARTTHINGS_LOCATION_ID=your_location_id
APP_PASSWORD=change_this_dashboard_password
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

## 4. 로컬 실행

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

## 5. Vercel 배포

1. 이 프로젝트를 GitHub, GitLab, 또는 Bitbucket 저장소에 push합니다.
2. Vercel에서 `Add New Project`를 선택하고 저장소를 연결합니다.
3. Framework Preset은 `Next.js`로 둡니다.
4. Vercel Project Settings의 `Environment Variables`에 아래 값을 추가합니다.

```bash
SMARTTHINGS_TOKEN=your_personal_access_token
SMARTTHINGS_DEVICE_ID=your_air_conditioner_device_id
SMARTTHINGS_LOCATION_ID=your_location_id
APP_PASSWORD=change_this_dashboard_password
```

5. 필요한 경우 선택 환경 변수도 같은 화면에 추가합니다.
6. `Deploy`를 실행합니다.

## 보안 메모

- `SMARTTHINGS_TOKEN`은 `NEXT_PUBLIC_` 접두사를 붙이지 마세요.
- 클라이언트 컴포넌트는 SmartThings API를 직접 호출하지 않고 `/api/ac/*`만 호출합니다.
- `APP_PASSWORD`를 설정하면 대시보드와 API Route가 앱 자체 비밀번호로 보호됩니다.
- Vercel의 `Deployment Protection`을 끄더라도 앱 비밀번호는 유지됩니다.
- `.env`, `.env.local`, `.vercel`은 `.gitignore`에 포함되어 있습니다.

## API Routes

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

`off` 요청은 바로 전원을 끄지 않습니다. 현재 전원이 켜져 있으면 송풍 모드로 전환하고 1시간 뒤 전원을 끄는 SmartThings Rule을 생성합니다. 이미 꺼져 있으면 추가 예약 없이 현재 상태만 반환합니다.

### `POST /api/ac/temperature`

```json
{ "temperature": 24 }
```

### `POST /api/ac/climate`

냉방 온도 적용:

```json
{ "mode": "cool", "temperature": 24 }
```

송풍 전환:

```json
{ "mode": "wind" }
```

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

전원 예약 목록을 반환합니다.

### `POST /api/ac/schedules`

```json
{ "power": "off", "runAt": "2026-07-27T23:30:00.000Z" }
```

꺼짐 예약은 지정한 시각에 송풍 모드로 전환하고, 1시간 뒤 전원을 끄는 SmartThings Rule을 생성합니다.

켜짐 예약은 냉방 모드로 고정되며 `coolingSetpoint`로 희망 온도를 지정합니다.

```json
{ "power": "on", "runAt": "2026-07-27T23:30:00.000Z", "coolingSetpoint": 24 }
```

`power`는 `on` 또는 `off`입니다. `runAt`은 현재보다 이후의 ISO 날짜 문자열이어야 합니다.

### `DELETE /api/ac/schedules/:id`

대기 중인 예약을 취소합니다.

## 예약 동작

예약은 SmartThings 공식 Rules API로 SmartThings Cloud에 등록됩니다. 이 앱이 만든 Rule만 `SmartThings AC Reservation` 이름 prefix로 필터링해 보여줍니다. 로컬 서버가 꺼져 있어도 SmartThings Cloud에 등록된 예약 자체는 남아 있습니다.
