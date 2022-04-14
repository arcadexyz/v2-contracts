





1. install OZ upgradeable ```yarn add @openzeppelin/contracts-upgradeable```
2. replace imports with ones that include the ```Upgradeable``` suffix
```
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
contract MyCollectible is ERC721Upgradeable {
```
3. replace constructors by internal initializer functions with naming convention ``` __{ContractName}_init```
4. define a public initializer function and call the parent initializer of the contract being extended
```
function initialize() initializer public {
        __ERC721_init("MyCollectible", "MCO");
     }
```
With [multiple inheritance](https://docs.openzeppelin.com/contracts/4.x/upgradeable#multiple-inheritance), use ``` __{ContractName}_init_unchained``` to avoid double initialization of the same parent contracts.\
5. compile contract and for deploy with Upgrades Plugins\
6.



Other:
- create MultiSig for performing actual upgrade
- Contract needs to be EIP1967-compatible
- ```prepare_upgrade.js``` script needed to specify the Proxy Address
- Network files: commit to [source control](https://docs.openzeppelin.com/upgrades-plugins/1.x/network-files) the files for all networks except the development ones.
The development version can be ignored:
```
// .gitignore
# OpenZeppelin
.openzeppelin/unknown-*.json
```