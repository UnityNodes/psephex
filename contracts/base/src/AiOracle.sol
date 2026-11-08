// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAiOracle, IAiOracleClient} from "./IAiOracle.sol";

contract AiOracle is IAiOracle {
    uint256 public constant DEFAULT_CALLBACK_GAS_LIMIT = 200_000;

    address public owner;
    address public oracle;
    uint256 public lastId;
    uint256 public callbackGasLimit;

    mapping(uint256 => Request) private _requests;

    error OnlyOwner();
    error OnlyOracle();
    error ZeroAddress();
    error UnknownRequest(uint256 id);
    error AlreadyFulfilled(uint256 id);
    error QuestionHashMismatch(bytes32 expected, bytes32 provided);
    error InvalidAnswer(uint8 answer);
    error WithdrawFailed();

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Withdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(address oracle_, address owner_) {
        if (oracle_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        oracle = oracle_;
        owner = owner_;
        callbackGasLimit = DEFAULT_CALLBACK_GAS_LIMIT;
        emit OracleUpdated(address(0), oracle_);
        emit OwnershipTransferred(address(0), owner_);
    }

    function setOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert ZeroAddress();
        emit OracleUpdated(oracle, newOracle);
        oracle = newOracle;
    }

    function setCallbackGasLimit(uint256 newLimit) external onlyOwner {
        emit CallbackGasLimitUpdated(callbackGasLimit, newLimit);
        callbackGasLimit = newLimit;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function withdraw(address payable to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = address(this).balance;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert WithdrawFailed();
        emit Withdrawn(to, amount);
    }

    function ask(string calldata question) external payable returns (uint256 id) {
        id = ++lastId;
        bytes32 questionHash = keccak256(bytes(question));
        _requests[id] = Request({requester: msg.sender, questionHash: questionHash, fulfilled: false});
        emit Asked(id, msg.sender, question, questionHash);
    }

    function fulfill(uint256 id, uint8 answer, bytes32 questionHash) external {
        if (msg.sender != oracle) revert OnlyOracle();
        Request storage req = _requests[id];
        if (req.requester == address(0)) revert UnknownRequest(id);
        if (req.fulfilled) revert AlreadyFulfilled(id);
        if (req.questionHash != questionHash) revert QuestionHashMismatch(req.questionHash, questionHash);
        if (answer > uint8(Answer.NO)) revert InvalidAnswer(answer);

        req.fulfilled = true;
        emit Fulfilled(id, answer);

        address requester = req.requester;
        if (requester.code.length > 0) {
            try IAiOracleClient(requester).onAnswer{gas: callbackGasLimit}(id, answer) {}
            catch {
                emit CallbackFailed(id);
            }
        }
    }

    function getRequest(uint256 id) external view returns (Request memory) {
        return _requests[id];
    }
}
