import { useMemo, useState } from 'react'
import SellerLayout from '../SellerLayout'
import { navigateTo } from '../../navigation'
import './shipping-settings.css'

const tabs = [
  { key: 'zones', label: 'Shipping Zones' },
  { key: 'methods', label: 'Shipping Methods' },
  { key: 'rates', label: 'Shipping Rates' },
  { key: 'delivery', label: 'Delivery Settings' },
  { key: 'package', label: 'Package Settings' },
  { key: 'pickup', label: 'Pickup Settings' },
  { key: 'providers', label: 'Shipping Providers' },
  { key: 'tracking', label: 'Tracking Settings' },
]

const defaultZones = [
  { name: 'Pakistan — Nationwide', countries: 'Pakistan', provinces: 'All provinces', cities: 'Lahore, Karachi, Islamabad', delivery: '3-5 days', methods: 'Standard, Express', rate: 'From Rs. 250', status: 'Active' },
  { name: 'Punjab', countries: 'Pakistan', provinces: 'Punjab', cities: 'Lahore, Faisalabad, Multan', delivery: '2-4 days', methods: 'Standard, Same Day', rate: 'From Rs. 180', status: 'Active' },
  { name: 'Sindh', countries: 'Pakistan', provinces: 'Sindh', cities: 'Karachi, Hyderabad', delivery: '3-5 days', methods: 'Standard', rate: 'From Rs. 220', status: 'Disabled' },
  { name: 'Islamabad / Rawalpindi', countries: 'Pakistan', provinces: 'ICT', cities: 'Islamabad, Rawalpindi', delivery: '2-3 days', methods: 'Standard, Express', rate: 'From Rs. 200', status: 'Active' },
]

const defaultMethods = [
  { name: 'Standard Delivery', description: 'Cost-effective shipping for nationwide delivery', estimate: '3-5 business days', zones: 'All zones', rate: 'Rs. 250', status: 'Enabled' },
  { name: 'Express Delivery', description: 'Fast delivery for urgent orders', estimate: '1-2 business days', zones: 'Punjab, Islamabad', rate: 'Rs. 600', status: 'Enabled' },
  { name: 'Same Day Delivery', description: 'For orders placed before the cutoff', estimate: 'Same day', zones: 'Lahore, Karachi', rate: 'Rs. 900', status: 'Disabled' },
  { name: 'Store Pickup', description: 'Customer picks up from your outlet', estimate: 'Same day', zones: 'All branches', rate: 'Free', status: 'Enabled' },
]

const defaultRates = [
  { zone: 'Pakistan — Nationwide', method: 'Standard Delivery', type: 'Flat Rate', order: 'Rs. 0 - 2,999', weight: '0-1 kg', fee: 'Rs. 250', threshold: 'Not set', status: 'Active' },
  { zone: 'Pakistan — Nationwide', method: 'Express Delivery', type: 'Weight Based', order: 'Rs. 3,000+', weight: '1-3 kg', fee: 'Rs. 450', threshold: 'Rs. 5,000', status: 'Active' },
  { zone: 'Punjab', method: 'Standard Delivery', type: 'Free Shipping', order: 'Rs. 5,000+', weight: '0-5 kg', fee: 'Free', threshold: 'Rs. 5,000', status: 'Inactive' },
  { zone: 'Islamabad / Rawalpindi', method: 'Same Day Delivery', type: 'Calculated Rate', order: 'Rs. 0 - 4,999', weight: '0-5 kg', fee: 'Calculated', threshold: 'Rs. 3,000', status: 'Active' },
]

const defaultPickupLocations = [
  { name: 'Mirwal Store — Lahore', address: 'Gulberg Main Road, Lahore', contact: '+92 300 1234567', hours: 'Mon-Sat, 10:00 AM - 8:00 PM', status: 'Active' },
  { name: 'Mirwal Store — Karachi', address: 'Clifton Block 5, Karachi', contact: '+92 321 7654321', hours: 'Mon-Sat, 11:00 AM - 7:00 PM', status: 'Inactive' },
]

const defaultProviders = [
  { name: 'TCS', status: 'Connected', service: 'Domestic shipping', coverage: 'Pakistan-wide', support: 'Tracking', action: 'Configure' },
  { name: 'Leopards', status: 'Needs Attention', service: 'Express courier', coverage: 'Major cities', support: 'Tracking', action: 'Connect' },
  { name: 'M&P', status: 'Not Connected', service: 'Regional routes', coverage: 'Punjab + KP', support: 'No', action: 'Connect' },
]

const emptyStates = {
  zones: { title: 'No shipping zones yet', text: 'Create your first shipping zone to start delivering orders.' },
  methods: { title: 'No shipping methods configured', text: 'Add a delivery option to begin fulfilling customer orders.' },
  rates: { title: 'No shipping rates configured', text: 'Set up pricing rules for zones and methods.' },
  pickup: { title: 'No pickup locations', text: 'Add a pickup point so customers can collect their orders.' },
  providers: { title: 'No shipping provider connected', text: 'Connect a courier to enable shipment tracking and delivery updates.' },
}

function StatusBadge({ status }) {
  const key = String(status || '').toLowerCase()
  const tone = key.includes('active') || key.includes('connected') || key.includes('enabled') || key.includes('verified') ? 'success'
    : key.includes('disabled') || key.includes('inactive') || key.includes('not connected') || key.includes('needs attention') ? 'danger'
    : key.includes('warning') || key.includes('pending') || key.includes('needs') ? 'warning'
    : 'info'

  return <span className={`status-badge ${tone}`}>{status}</span>
}

function EmptyState({ title, text }) {
  return (
    <div className="shipping-empty-state">
      <div className="empty-icon"><i className="fa-solid fa-truck" /></div>
      <h3>{title}</h3>
      <p>{text}</p>
      <button type="button" className="btn-primary">Add now</button>
    </div>
  )
}

function ShippingSettings({ page = 'zones' }) {
  const activePage = tabs.some((tab) => tab.key === page) ? page : 'zones'
  const [zones] = useState(defaultZones)
  const [methods] = useState(defaultMethods)
  const [rates] = useState(defaultRates)
  const [pickups] = useState(defaultPickupLocations)
  const [providers] = useState(defaultProviders)

  const currentTab = useMemo(() => tabs.find((tab) => tab.key === activePage) || tabs[0], [activePage])

  const openTab = (key) => navigateTo(`/seller/store/shipping/${key === 'zones' ? '' : key}`)

  const renderZones = () => (
    <div className="shipping-panel-grid">
      <section className="shipping-panel">
        <div className="shipping-panel-header">
          <div>
            <h2>Shipping Zones</h2>
            <p>Define where your store delivers and configure shipping rules for each delivery area.</p>
          </div>
          <button type="button" className="btn-primary"><i className="fa-solid fa-plus" /> Add Zone</button>
        </div>

        {zones.length === 0 ? (
          <EmptyState {...emptyStates.zones} />
        ) : (
          <div className="table-wrap">
            <table className="shipping-table">
              <thead>
                <tr>
                  <th>Zone Name</th>
                  <th>Countries</th>
                  <th>Provinces / States</th>
                  <th>Delivery Time</th>
                  <th>Shipping Methods</th>
                  <th>Rate</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((zone) => (
                  <tr key={zone.name}>
                    <td><strong>{zone.name}</strong></td>
                    <td>{zone.countries}</td>
                    <td>{zone.provinces}</td>
                    <td>{zone.delivery}</td>
                    <td>{zone.methods}</td>
                    <td>{zone.rate}</td>
                    <td><StatusBadge status={zone.status} /></td>
                    <td className="table-actions">
                      <button type="button">Edit</button>
                      <button type="button">Manage Rates</button>
                      <button type="button">{zone.status === 'Active' ? 'Disable' : 'Enable'}</button>
                      <button type="button">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="shipping-form-block">
          <h3>Add Shipping Zone</h3>
          <div className="shipping-form-grid">
            <label><span>Zone Name *</span><input defaultValue="Northern Pakistan" /></label>
            <label><span>Country *</span><select defaultValue="Pakistan"><option>Pakistan</option></select></label>
            <label><span>Province / State</span><input defaultValue="Khyber Pakhtunkhwa" /></label>
            <label><span>Cities / Areas</span><input defaultValue="Peshawar, Abbottabad" /></label>
            <label><span>Postal Codes</span><input defaultValue="25000, 26000" /></label>
            <label><span>Estimated Delivery Time</span><input defaultValue="4-6 days" /></label>
            <label><span>Status</span><select defaultValue="Active"><option>Active</option><option>Disabled</option></select></label>
            <button type="button" className="btn-secondary add-region-btn"><i className="fa-solid fa-plus" /> Add Region</button>
          </div>
        </div>
      </section>
    </div>
  )

  const renderMethods = () => (
    <div className="shipping-panel-grid">
      <section className="shipping-panel">
        <div className="shipping-panel-header">
          <div>
            <h2>Shipping Methods</h2>
            <p>Offer delivery options that fit your service and customer expectations.</p>
          </div>
          <button type="button" className="btn-primary"><i className="fa-solid fa-plus" /> Add Shipping Method</button>
        </div>

        {methods.length === 0 ? (
          <EmptyState {...emptyStates.methods} />
        ) : (
          <div className="method-card-grid">
            {methods.map((method) => (
              <article key={method.name} className="method-card">
                <div className="method-card-head">
                  <div>
                    <h3>{method.name}</h3>
                    <p>{method.description}</p>
                  </div>
                  <StatusBadge status={method.status} />
                </div>
                <div className="method-metrics">
                  <div><span>Delivery estimate</span><strong>{method.estimate}</strong></div>
                  <div><span>Available zones</span><strong>{method.zones}</strong></div>
                  <div><span>Price / Rate</span><strong>{method.rate}</strong></div>
                </div>
                <div className="method-card-actions">
                  <label className="toggle-row"><input type="checkbox" defaultChecked={method.status === 'Enabled'} /><span>{method.status === 'Enabled' ? 'Enabled' : 'Disabled'}</span></label>
                  <button type="button" className="btn-secondary">Edit</button>
                  <button type="button" className="btn-ghost">Delete</button>
                </div>
              </article>
            ))}
          </div>
        )}

        <div className="shipping-form-block">
          <h3>Add Shipping Method</h3>
          <div className="shipping-form-grid">
            <label><span>Method Name *</span><input defaultValue="Priority Delivery" /></label>
            <label><span>Description</span><input defaultValue="Faster last-mile delivery for high-priority orders" /></label>
            <label><span>Delivery Estimate *</span><input defaultValue="1-2 business days" /></label>
            <label><span>Available Zones</span><select defaultValue="All zones"><option>All zones</option><option>Punjab</option></select></label>
            <label><span>Rate Type</span><select defaultValue="Flat Rate"><option>Flat Rate</option><option>Free Shipping</option><option>Calculated Rate</option></select></label>
            <label><span>Status</span><select defaultValue="Enabled"><option>Enabled</option><option>Disabled</option></select></label>
          </div>
        </div>
      </section>
    </div>
  )

  const renderRates = () => (
    <div className="shipping-panel-grid">
      <section className="shipping-panel">
        <div className="shipping-panel-header">
          <div>
            <h2>Shipping Rates</h2>
            <p>Control shipping charges based on zone, method, weight and order value.</p>
          </div>
          <button type="button" className="btn-primary"><i className="fa-solid fa-plus" /> Add Rate</button>
        </div>

        <div className="filter-row">
          <label><span>Zone</span><select><option>All zones</option></select></label>
          <label><span>Method</span><select><option>All methods</option></select></label>
          <label><span>Status</span><select><option>All status</option></select></label>
        </div>

        {rates.length === 0 ? (
          <EmptyState {...emptyStates.rates} />
        ) : (
          <div className="table-wrap">
            <table className="shipping-table">
              <thead>
                <tr>
                  <th>Zone</th>
                  <th>Method</th>
                  <th>Rate Type</th>
                  <th>Order Value</th>
                  <th>Weight Range</th>
                  <th>Shipping Fee</th>
                  <th>Free Shipping Threshold</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rates.map((rate) => (
                  <tr key={`${rate.zone}-${rate.method}-${rate.type}`}>
                    <td>{rate.zone}</td>
                    <td>{rate.method}</td>
                    <td>{rate.type}</td>
                    <td>{rate.order}</td>
                    <td>{rate.weight}</td>
                    <td>{rate.fee}</td>
                    <td>{rate.threshold}</td>
                    <td><StatusBadge status={rate.status} /></td>
                    <td className="table-actions compact"><button type="button">Edit</button><button type="button">Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="shipping-form-block">
          <h3>Add / Edit Rate</h3>
          <div className="shipping-form-grid">
            <label><span>Shipping Zone *</span><select defaultValue="Pakistan — Nationwide"><option>Pakistan — Nationwide</option></select></label>
            <label><span>Shipping Method *</span><select defaultValue="Standard Delivery"><option>Standard Delivery</option></select></label>
            <label><span>Rate Type *</span><select defaultValue="Flat Rate"><option>Flat Rate</option><option>Free Shipping</option><option>Weight Based</option><option>Order Value Based</option></select></label>
            <label><span>Minimum Order Value</span><input defaultValue="Rs. 0" /></label>
            <label><span>Maximum Order Value</span><input defaultValue="Rs. 2,999" /></label>
            <label><span>Minimum Weight</span><input defaultValue="0 kg" /></label>
            <label><span>Maximum Weight</span><input defaultValue="1 kg" /></label>
            <label><span>Shipping Fee</span><input defaultValue="Rs. 250" /></label>
            <label><span>Free Shipping Threshold</span><input defaultValue="Rs. 5,000" /></label>
            <label><span>Status</span><select defaultValue="Active"><option>Active</option><option>Inactive</option></select></label>
          </div>
        </div>
      </section>
    </div>
  )

  const renderDelivery = () => (
    <div className="shipping-panel-grid">
      <section className="shipping-panel">
        <div className="shipping-panel-header">
          <div>
            <h2>Delivery Settings</h2>
            <p>Set delivery expectations and order handling rules for your store.</p>
          </div>
        </div>

        <div className="two-column-layout">
          <div className="shipping-form-block">
            <h3>Default Delivery Time</h3>
            <div className="shipping-form-grid">
              <label><span>Processing Time</span><input defaultValue="1-2 business days" /></label>
              <label><span>Minimum Delivery Days</span><input defaultValue="3" /></label>
              <label><span>Maximum Delivery Days</span><input defaultValue="5" /></label>
            </div>
          </div>

          <div className="shipping-form-block">
            <h3>Order Processing</h3>
            <div className="toggle-stack">
              <label className="toggle-row"><input type="checkbox" defaultChecked /><span>Orders received before cutoff</span></label>
              <label className="toggle-row"><input type="checkbox" defaultChecked /><span>Same-day processing</span></label>
              <label className="toggle-row"><input type="checkbox" /><span>Weekend processing</span></label>
            </div>
          </div>
        </div>

        <div className="two-column-layout">
          <div className="shipping-form-block">
            <h3>Delivery Preferences</h3>
            <div className="toggle-stack">
              <label className="toggle-row"><input type="checkbox" defaultChecked /><span>Allow weekend delivery</span></label>
              <label className="toggle-row"><input type="checkbox" /><span>Allow holiday delivery</span></label>
              <label className="toggle-row"><input type="checkbox" defaultChecked /><span>Delivery instructions</span></label>
            </div>
          </div>

          <div className="shipping-form-block">
            <h3>Order Cutoff</h3>
            <div className="shipping-form-grid">
              <label className="toggle-row checkbox-field"><input type="checkbox" defaultChecked /><span>Enable cutoff time</span></label>
              <label><span>Cutoff time</span><input type="time" defaultValue="18:00" /></label>
            </div>
          </div>
        </div>

        <div className="preview-box">
          <strong>Estimated delivery: 3–5 business days</strong>
        </div>
      </section>
    </div>
  )

  const renderPackage = () => (
    <div className="shipping-panel-grid">
      <section className="shipping-panel">
        <div className="shipping-panel-header">
          <div>
            <h2>Package Settings</h2>
            <p>Set default packaging dimensions and shipping standards for your products.</p>
          </div>
        </div>

        <div className="two-column-layout">
          <div className="shipping-form-block">
            <h3>Default Package</h3>
            <div className="shipping-form-grid">
              <label><span>Package Name</span><input defaultValue="Standard Box" /></label>
              <label><span>Weight Unit</span><select defaultValue="kg"><option>kg</option><option>g</option></select></label>
              <label><span>Dimension Unit</span><select defaultValue="cm"><option>cm</option><option>in</option></select></label>
              <label><span>Default Weight</span><input defaultValue="1.5 kg" /></label>
              <label><span>Length</span><input defaultValue="30 cm" /></label>
              <label><span>Width</span><input defaultValue="20 cm" /></label>
              <label><span>Height</span><input defaultValue="15 cm" /></label>
            </div>
          </div>

          <div className="shipping-form-block">
            <h3>Product Shipping Defaults</h3>
            <div className="toggle-stack">
              <label className="toggle-row"><input type="checkbox" defaultChecked /><span>Requires shipping</span></label>
              <label className="toggle-row"><input type="checkbox" /><span>Fragile</span></label>
              <label className="toggle-row"><input type="checkbox" /><span>Oversized</span></label>
              <label className="toggle-row"><input type="checkbox" /><span>Dangerous goods</span></label>
              <label className="toggle-row"><input type="checkbox" /><span>Temperature sensitive</span></label>
            </div>
          </div>
        </div>

        <div className="shipping-form-block">
          <h3>Package Presets</h3>
          <div className="preset-chips">
            <span className="preset-chip active">Small</span>
            <span className="preset-chip">Medium</span>
            <span className="preset-chip">Large</span>
            <span className="preset-chip">Custom</span>
          </div>
          <div className="table-wrap">
            <table className="shipping-table">
              <thead>
                <tr>
                  <th>Package Name</th>
                  <th>Dimensions</th>
                  <th>Weight Limit</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Small</td>
                  <td>20 x 15 x 10 cm</td>
                  <td>1.5 kg</td>
                  <td><StatusBadge status="Default" /></td>
                  <td className="table-actions compact"><button type="button">Edit</button><button type="button">Delete</button><button type="button">Set Default</button></td>
                </tr>
                <tr>
                  <td>Medium</td>
                  <td>30 x 20 x 15 cm</td>
                  <td>3 kg</td>
                  <td><StatusBadge status="Active" /></td>
                  <td className="table-actions compact"><button type="button">Edit</button><button type="button">Delete</button><button type="button">Set Default</button></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  )

  const renderPickup = () => (
    <div className="shipping-panel-grid">
      <section className="shipping-panel">
        <div className="shipping-panel-header">
          <div>
            <h2>Pickup Settings</h2>
            <p>Allow sellers to offer customer pickup for selected orders.</p>
          </div>
        </div>

        <div className="toggle-bar">
          <label className="toggle-row"><input type="checkbox" defaultChecked /><span>Enable Store Pickup</span></label>
        </div>

        {pickups.length === 0 ? (
          <EmptyState {...emptyStates.pickup} />
        ) : (
          <div className="table-wrap">
            <table className="shipping-table">
              <thead>
                <tr>
                  <th>Location</th>
                  <th>Address</th>
                  <th>Contact</th>
                  <th>Pickup Hours</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pickups.map((location) => (
                  <tr key={location.name}>
                    <td>{location.name}</td>
                    <td>{location.address}</td>
                    <td>{location.contact}</td>
                    <td>{location.hours}</td>
                    <td><StatusBadge status={location.status} /></td>
                    <td className="table-actions compact"><button type="button">Edit</button><button type="button">Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="shipping-form-block">
          <h3>Add Pickup Location</h3>
          <div className="shipping-form-grid">
            <label><span>Location Name *</span><input defaultValue="Mirwal Store — Lahore" /></label>
            <label><span>Address *</span><input defaultValue="House 12, Gulberg III, Lahore" /></label>
            <label><span>City *</span><input defaultValue="Lahore" /></label>
            <label><span>Contact Number *</span><input defaultValue="+92 300 1234567" /></label>
            <label><span>Pickup Days</span><input defaultValue="Mon-Sat" /></label>
            <label><span>Opening Time</span><input type="time" defaultValue="10:00" /></label>
            <label><span>Closing Time</span><input type="time" defaultValue="20:00" /></label>
            <label><span>Instructions</span><input defaultValue="Bring order ID or mobile confirmation" /></label>
          </div>
        </div>

        <div className="preview-box">
          <strong>Pickup available from: Mirwal Store — Lahore</strong>
        </div>
      </section>
    </div>
  )

  const renderProviders = () => (
    <div className="shipping-panel-grid">
      <section className="shipping-panel">
        <div className="shipping-panel-header">
          <div>
            <h2>Shipping Providers</h2>
            <p>Connect couriers and delivery partners for shipment fulfillment and tracking.</p>
          </div>
        </div>

        {providers.length === 0 ? (
          <EmptyState {...emptyStates.providers} />
        ) : (
          <div className="provider-grid">
            {providers.map((provider) => (
              <article key={provider.name} className="provider-card">
                <div className="provider-card-head">
                  <h3>{provider.name}</h3>
                  <StatusBadge status={provider.status} />
                </div>
                <dl>
                  <div><dt>Service Type</dt><dd>{provider.service}</dd></div>
                  <div><dt>Coverage</dt><dd>{provider.coverage}</dd></div>
                  <div><dt>Tracking Support</dt><dd>{provider.support}</dd></div>
                </dl>
                <div className="provider-actions">
                  <button type="button" className="btn-secondary">Configure</button>
                  <button type="button" className="btn-ghost">Disconnect</button>
                </div>
              </article>
            ))}
          </div>
        )}

        <div className="shipping-form-block">
          <h3>Add Provider</h3>
          <div className="shipping-form-grid">
            <label><span>Provider</span><select defaultValue="TCS"><option>TCS</option><option>Leopards</option><option>BlueEx</option></select></label>
            <label><span>Account ID</span><input defaultValue="MIRWAL-TCS-001" /></label>
            <label><span>API Key</span><input type="password" defaultValue="**************" /></label>
            <label><span>API Secret</span><input type="password" defaultValue="**************" /></label>
            <label><span>Environment</span><select defaultValue="Production"><option>Production</option><option>Sandbox</option></select></label>
            <label className="toggle-row checkbox-field"><input type="checkbox" defaultChecked /><span>Enable Tracking</span></label>
          </div>
        </div>
      </section>
    </div>
  )

  const renderTracking = () => (
    <div className="shipping-panel-grid">
      <section className="shipping-panel">
        <div className="shipping-panel-header">
          <div>
            <h2>Tracking Settings</h2>
            <p>Keep customers informed on order status and delivery progress.</p>
          </div>
        </div>

        <div className="two-column-layout">
          <div className="shipping-form-block">
            <h3>Tracking</h3>
            <div className="toggle-stack">
              <label className="toggle-row"><input type="checkbox" defaultChecked /><span>Enable order tracking</span></label>
              <label className="toggle-row"><input type="checkbox" defaultChecked /><span>Automatically update tracking status</span></label>
              <label className="toggle-row"><input type="checkbox" defaultChecked /><span>Send tracking notifications</span></label>
            </div>
          </div>

          <div className="shipping-form-block">
            <h3>Customer Tracking</h3>
            <div className="toggle-stack">
              <label className="toggle-row"><input type="checkbox" defaultChecked /><span>Show tracking number</span></label>
              <label className="toggle-row"><input type="checkbox" defaultChecked /><span>Show courier name</span></label>
              <label className="toggle-row"><input type="checkbox" defaultChecked /><span>Show estimated delivery</span></label>
            </div>
          </div>
        </div>

        <div className="shipping-form-block">
          <h3>Notifications</h3>
          <div className="toggle-stack two-column-list">
            <label className="toggle-row"><input type="checkbox" defaultChecked /><span>Order shipped</span></label>
            <label className="toggle-row"><input type="checkbox" defaultChecked /><span>Out for delivery</span></label>
            <label className="toggle-row"><input type="checkbox" defaultChecked /><span>Delivered</span></label>
            <label className="toggle-row"><input type="checkbox" /><span>Delivery delayed</span></label>
          </div>
        </div>

        <div className="tracking-timeline">
          <h3>Tracking Timeline Preview</h3>
          <div className="timeline-steps">
            <span>Order Confirmed</span>
            <i className="fa-solid fa-arrow-right" />
            <span>Processing</span>
            <i className="fa-solid fa-arrow-right" />
            <span>Shipped</span>
            <i className="fa-solid fa-arrow-right" />
            <span>In Transit</span>
            <i className="fa-solid fa-arrow-right" />
            <span>Out for Delivery</span>
            <i className="fa-solid fa-arrow-right" />
            <span>Delivered</span>
          </div>
        </div>

        <div className="mini-summary">
          <div><span>Tracking URL</span><strong>https://mirwal.pk/track/MP-42A7</strong></div>
          <div><span>Tracking Number</span><strong>MP-42A7</strong></div>
          <div><span>Shipping Provider</span><strong>TCS</strong></div>
        </div>
      </section>
    </div>
  )

  const renderContent = () => {
    if (activePage === 'zones') return renderZones()
    if (activePage === 'methods') return renderMethods()
    if (activePage === 'rates') return renderRates()
    if (activePage === 'delivery') return renderDelivery()
    if (activePage === 'package') return renderPackage()
    if (activePage === 'pickup') return renderPickup()
    if (activePage === 'providers') return renderProviders()
    return renderTracking()
  }

  return (
    <SellerLayout activeItem="shipping-settings" breadcrumbs={[{ label: 'Dashboard', onClick: () => navigateTo('/seller') }, { label: 'Shipping Settings' }, { label: currentTab.label }]}>
      <div className="shipping-settings-container">
        <div className="shipping-settings-header">
          <div>
            <h1>Shipping Settings</h1>
            <p>Manage how your products are shipped, delivered and tracked.</p>
          </div>
          <button type="button" className="btn-secondary"><i className="fa-solid fa-eye" /> View Store</button>
        </div>

        <nav className="shipping-settings-tabs" aria-label="Shipping settings tabs">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`shipping-settings-tab ${activePage === tab.key ? 'active' : ''}`}
              onClick={() => openTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {renderContent()}
      </div>
    </SellerLayout>
  )
}

export default ShippingSettings
