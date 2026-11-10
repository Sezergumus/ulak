use serde::Serialize;

#[derive(Serialize)]
pub struct NetworkChoice {
    name: String,
    address: String,
    range: String,
}

#[cfg(windows)]
pub fn choices() -> Result<Vec<NetworkChoice>, String> {
    use std::{net::Ipv4Addr, ptr};
    use windows_sys::Win32::{
        Foundation::{ERROR_BUFFER_OVERFLOW, ERROR_NO_DATA, NO_ERROR},
        NetworkManagement::{
            IpHelper::{
                GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST,
                GetAdaptersAddresses, IF_TYPE_ETHERNET_CSMACD, IF_TYPE_IEEE80211,
                IP_ADAPTER_ADDRESSES_LH,
            },
            Ndis::IfOperStatusUp,
        },
        Networking::WinSock::{AF_INET, SOCKADDR_IN},
    };

    // A u64 buffer meets the alignment required by the Windows adapter structures.
    // Bound both allocation and retries if interfaces change during enumeration.
    let mut size = 16_384u32;
    for _ in 0..3 {
        if size > 1024 * 1024 {
            return Err("The network list is too large. Use advanced settings.".into());
        }
        let mut buffer = vec![0u64; (size as usize).div_ceil(8)];
        let first = buffer.as_mut_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
        // Windows owns the linked pointers inside this buffer until it is dropped.
        let result = unsafe {
            GetAdaptersAddresses(
                AF_INET as u32,
                GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_DNS_SERVER | GAA_FLAG_SKIP_MULTICAST,
                ptr::null(),
                first,
                &mut size,
            )
        };
        if result == ERROR_BUFFER_OVERFLOW {
            continue;
        }
        if result == ERROR_NO_DATA {
            return Ok(Vec::new());
        }
        if result != NO_ERROR {
            return Err(format!(
                "Could not read available networks (Windows error {result})."
            ));
        }
        let mut choices = Vec::new();
        let mut adapter = first;
        while !adapter.is_null() && choices.len() < 64 {
            // All pointers below come from the successful GetAdaptersAddresses call.
            let current = unsafe { &*adapter };
            adapter = current.Next;
            if current.OperStatus != IfOperStatusUp
                || !matches!(current.IfType, IF_TYPE_ETHERNET_CSMACD | IF_TYPE_IEEE80211)
            {
                continue;
            }
            let name = if current.FriendlyName.is_null() {
                "Local network".to_string()
            } else {
                let mut length = 0;
                while length < 256 && unsafe { *current.FriendlyName.add(length) } != 0 {
                    length += 1;
                }
                String::from_utf16_lossy(unsafe {
                    std::slice::from_raw_parts(current.FriendlyName, length)
                })
            };
            let mut unicast = current.FirstUnicastAddress;
            while !unicast.is_null() && choices.len() < 64 {
                let entry = unsafe { &*unicast };
                unicast = entry.Next;
                if entry.Address.lpSockaddr.is_null()
                    || entry.Address.iSockaddrLength < std::mem::size_of::<SOCKADDR_IN>() as i32
                    || unsafe { (*entry.Address.lpSockaddr).sa_family } != AF_INET
                    || entry.OnLinkPrefixLength == 0
                    || entry.OnLinkPrefixLength > 32
                {
                    continue;
                }
                let socket = unsafe { &*entry.Address.lpSockaddr.cast::<SOCKADDR_IN>() };
                let address = Ipv4Addr::from(unsafe { socket.sin_addr.S_un.S_addr }.to_ne_bytes());
                if address.is_loopback() || address.is_unspecified() || address.is_link_local() {
                    continue;
                }
                let range = ipv4_range(address, entry.OnLinkPrefixLength);
                if !choices
                    .iter()
                    .any(|choice: &NetworkChoice| choice.address == address.to_string())
                {
                    choices.push(NetworkChoice {
                        name: name.clone(),
                        address: address.to_string(),
                        range,
                    });
                }
            }
        }
        choices.sort_by(|a, b| (&a.name, &a.address).cmp(&(&b.name, &b.address)));
        return Ok(choices);
    }
    Err("The network changed while loading. Reopen settings to try again.".into())
}

#[cfg(windows)]
fn ipv4_range(address: std::net::Ipv4Addr, prefix: u8) -> String {
    let mask = u32::MAX.checked_shl(32 - u32::from(prefix)).unwrap_or(0);
    format!(
        "{}/{prefix}",
        std::net::Ipv4Addr::from(u32::from(address) & mask)
    )
}

#[cfg(not(windows))]
pub fn choices() -> Result<Vec<NetworkChoice>, String> {
    Ok(Vec::new())
}

#[cfg(all(test, windows))]
mod tests {
    use super::ipv4_range;

    #[test]
    fn preserves_the_actual_adapter_prefix_instead_of_assuming_a_home_subnet() {
        assert_eq!(
            ipv4_range("192.168.42.97".parse().unwrap(), 23),
            "192.168.42.0/23"
        );
        assert_eq!(ipv4_range("10.24.5.9".parse().unwrap(), 16), "10.24.0.0/16");
        assert_eq!(ipv4_range("10.24.5.9".parse().unwrap(), 32), "10.24.5.9/32");
    }
}
