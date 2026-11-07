import Link from 'next/link';
import ProfileWorkspace from '../../../components/profile-workspace';
export default function SettingsPage(){return <><p><Link href="/configuration">Configuration: startup and broker network settings</Link></p><p><Link href="/settings/broker/angel-one">Broker connections → Angel One</Link></p><ProfileWorkspace/></>}
